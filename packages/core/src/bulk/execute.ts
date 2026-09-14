import PQueue from "p-queue"
import type { BrazeClient } from "../client.js"
import { BrazeError } from "../errors.js"
import { identifiersOf } from "../identity.js"
import type { Operation } from "../operation.js"
import { checkRecord } from "../validate.js"
import type { BulkOutcome, BulkRecord } from "./types.js"

export interface BulkOptions {
  /**
   * What a generated `recordId` is scoped to (`NEED-31`). Core does not know what a run is — this
   * is an opaque prefix, and it is required because a default would quietly make the generated ids
   * of two runs collide, which is the ambiguity the ruling rejected a bare row number for.
   */
  runId: string
  /** §38 of the brief. Four concurrent requests, not four threads. */
  concurrency?: number
  /** Stops pulling and scheduling. Work already in flight is allowed to finish. */
  signal?: AbortSignal
  /** Overrides the operation's own cap. For tests, and for an endpoint Braze has since changed. */
  batchSize?: number
}

const DEFAULT_CONCURRENCY = 4

/** No request carried this record — it was refused here, or never sent at all. */
const NO_BATCH = 0

/**
 * Turns a stream of records into Braze requests, and a stream of outcomes back.
 *
 * **An async iterable in, an async iterable out** (§37). Core learns nothing about files: the same
 * executor runs over a JSONL parser, a database cursor or a generator, which is also what lets a
 * million-record test exist without a million HTTP calls.
 *
 * ## Why this is a generator and not a loop with a callback
 *
 * The consumer's demand is the backpressure. A generator body only runs when somebody asks for the
 * next outcome, so a slow consumer — one writing a CSV row per record to a slow disk — stops the
 * source being read. §39 forbids the parser enqueuing two million promises, and the way to make
 * that impossible rather than merely unlikely is to never advance the source except from here.
 *
 * **At most `concurrency * 2` batches are outstanding at once** — queued, running, or finished and
 * waiting to be yielded, counted together. So at most `concurrency * 2 * batchSize` records are
 * resident: 600 at the defaults, whatever the input size. Counting the finished-but-unyielded ones
 * is the part that is easy to leave out and the part that makes the bound true.
 *
 * ## Every record comes back, and every outcome can be acted on
 *
 * A record refused here never reaches Braze and still gets an outcome (`invalid`); a record the
 * source still held when a signal arrived gets one too (`skipped`). Together with `recordId`, which
 * is never blank, that is what makes the audit answerable a week later: 500 records in, 500
 * outcomes out, each naming which run and which line it came from.
 */
export async function* executeBulk(
  client: BrazeClient,
  operation: Operation,
  records: AsyncIterable<BulkRecord>,
  options: BulkOptions,
): AsyncGenerator<BulkOutcome> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const batchSize = options.batchSize ?? operation.batchTotal ?? 1

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new BrazeError("validation_error", `${operation.id} has no usable batch size (${batchSize})`, {
      operation: operation.id,
    })
  }

  const queue = new PQueue({ concurrency })
  const maxQueued = concurrency * 2

  const source = records[Symbol.asyncIterator]()
  const ready: BulkOutcome[][] = []
  let wake: (() => void) | undefined
  let exhausted = false
  let batchId = 0

  // Set whenever a batch completes. Needed because yielding suspends this generator, and a
  // completion landing during a yield would otherwise resolve nothing and leave the next wait
  // asleep with no one left to wake it.
  let progressed = false

  const onProgress = () => {
    progressed = true
    wake?.()
    wake = undefined
  }

  /**
   * One request's worth of input, or nothing left.
   *
   * **The budget is records read, not records sent.** A record refused by `checkRecord` still
   * counts against `batchSize`, so a file where every line is malformed cannot grow one unit
   * without bound — the memory ceiling above holds whatever the input contains. The price is a
   * short request when a batch happens to contain bad lines, paid only by input that is already
   * wrong.
   */
  const nextUnit = async (): Promise<{ send: BulkRecord[]; invalid: BulkOutcome[] } | undefined> => {
    const send: BulkRecord[] = []
    const invalid: BulkOutcome[] = []
    let read = 0

    while (read < batchSize) {
      const step = await source.next()
      if (step.done) break
      read += 1

      const record = step.value
      const reason = checkRecord(operation, record.field, record.value)
      if (reason === undefined) {
        send.push(record)
        continue
      }

      invalid.push(
        outcome(record, options.runId, {
          batchId: NO_BATCH,
          status: "invalid",
          errorCode: "validation_error",
          errorMessage: reason,
        }),
      )
    }

    return read > 0 ? { send, invalid } : undefined
  }

  try {
    for (;;) {
      // Top up, but only into the space there is.
      //
      // **`ready.length` is part of the bound, and that is the whole trick.** Bounding only what
      // is queued and running looks right and is not: when Braze answers faster than the consumer
      // reads — a mock, a cache, a fast endpoint — the queue empties between pulls, the condition
      // stays true, and this loop reads the entire two-million-row file into `ready` while the
      // consumer is still on record one. Counting completed-but-unyielded work closes that.
      while (!exhausted && !options.signal?.aborted && queue.size + queue.pending + ready.length < maxQueued) {
        const unit = await nextUnit()
        if (!unit) {
          exhausted = true
          break
        }

        // An invalid record's outcome is already known, so it is yielded as soon as it is read
        // rather than waiting for a request it is not part of.
        if (unit.invalid.length > 0) ready.push(unit.invalid)

        if (unit.send.length === 0) continue

        batchId += 1
        const id = batchId
        void queue.add(async () => {
          ready.push(await dispatch(client, operation, unit.send, id, options))
          onProgress()
        })
      }

      while (ready.length > 0) {
        for (const settled of ready.shift() as BulkOutcome[]) yield settled
      }

      if (queue.size === 0 && queue.pending === 0) {
        if (exhausted || options.signal?.aborted) break
        // Nothing is in flight to wake us — a unit whose every record was refused schedules no
        // request — so the only way on is to read more input.
        continue
      }

      // A batch that finished while we were yielding has already made progress; waiting for
      // another wake-up would be waiting for something that has already happened.
      if (progressed) {
        progressed = false
        continue
      }

      await new Promise<void>((resolve) => {
        wake = resolve
      })
      progressed = false
    }

    // Anything still unread when a signal arrived never went, and says so rather than vanishing.
    if (options.signal?.aborted) {
      for (;;) {
        const step = await source.next()
        if (step.done) break
        yield outcome(step.value, options.runId, { batchId: NO_BATCH, status: "skipped" })
      }
    }
  } finally {
    // A consumer that stops early — `break` in a for-await, or a thrown error — must not leave
    // requests running against Braze with nobody reading the answers.
    queue.clear()
    await source.return?.()
  }
}

/**
 * One request, and an outcome for every record it carried — rule 5: a request with 75 users is 75
 * audit rows, because the user is the unit anyone cares about and the batch is transport.
 */
const dispatch = async (
  client: BrazeClient,
  operation: Operation,
  batch: readonly BulkRecord[],
  batchId: number,
  options: BulkOptions,
): Promise<BulkOutcome[]> => {
  const body: Record<string, unknown[]> = {}
  for (const record of batch) {
    const field = body[record.field] ?? []
    field.push(record.value)
    body[record.field] = field
  }

  try {
    const result = await client.execute(operation, { body }, options.signal ? { signal: options.signal } : {})

    return batch.map((record) =>
      outcome(record, options.runId, {
        batchId,
        // Never `success`: Braze accepted the request, and says nothing about the users inside it.
        status: "submitted",
        httpStatus: result.status,
        attempts: result.attempts,
        durationMs: Math.round(result.totalDurationMs),
      }),
    )
  } catch (error) {
    const failure = error instanceof BrazeError ? error : undefined

    // Rule 4 and §24: a connection that died after the request left may well have been processed.
    // Calling that `failed` invites a re-run that double-applies it.
    const status = failure?.code === "outcome_unknown" ? "unknown" : "failed"

    return batch.map((record) =>
      outcome(record, options.runId, {
        batchId,
        status,
        errorCode: failure?.code,
        errorMessage: failure?.message ?? (error instanceof Error ? error.message : String(error)),
      }),
    )
  }
}

/**
 * The one place an outcome is built, so the four ways a record can end — sent, refused by Braze,
 * refused here, never sent — cannot disagree about its identity. `NEED-31` is a property of every
 * row, and the row easiest to forget is `skipped`: an interrupted run is exactly when somebody
 * needs to know which records to re-send.
 */
const outcome = (
  record: BulkRecord,
  runId: string,
  settled: Omit<BulkOutcome, "row" | "recordId" | "recordIdSource" | "identity">,
): BulkOutcome => {
  // A CSV column that happens to be empty supplies `""`, which is an id nobody can act on.
  const own = record.recordId?.trim()

  return {
    row: record.row,
    recordId: own ? own : `${runId}-${record.row}`,
    recordIdSource: own ? "input" : "generated",
    identity: record.identity ?? identifiersOf(record.value),
    ...settled,
  }
}
