import PQueue from "p-queue"
import type { BrazeClient } from "../client.js"
import { BrazeError } from "../errors.js"
import type { Operation } from "../operation.js"
import type { BulkOutcome, BulkRecord } from "./types.js"

export interface BulkOptions {
  /** §38 of the brief. Four concurrent requests, not four threads. */
  concurrency?: number
  /** Stops pulling and scheduling. Work already in flight is allowed to finish. */
  signal?: AbortSignal
  /** Overrides the operation's own cap. For tests, and for an endpoint Braze has since changed. */
  batchSize?: number
}

const DEFAULT_CONCURRENCY = 4

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
 */
export async function* executeBulk(
  client: BrazeClient,
  operation: Operation,
  records: AsyncIterable<BulkRecord>,
  options: BulkOptions = {},
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
   * One batch, or nothing left. Reads no further than `batchSize` — the buffer this holds is the
   * only place input accumulates.
   */
  const nextBatch = async (): Promise<BulkRecord[] | undefined> => {
    const batch: BulkRecord[] = []
    while (batch.length < batchSize) {
      const step = await source.next()
      if (step.done) break
      batch.push(step.value)
    }
    return batch.length > 0 ? batch : undefined
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
        const batch = await nextBatch()
        if (!batch) {
          exhausted = true
          break
        }

        batchId += 1
        const id = batchId
        void queue.add(async () => {
          ready.push(await send(client, operation, batch, id, options.signal))
          onProgress()
        })
      }

      while (ready.length > 0) {
        for (const outcome of ready.shift() as BulkOutcome[]) yield outcome
      }

      const idle = queue.size === 0 && queue.pending === 0
      if (idle && (exhausted || options.signal?.aborted)) break

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
        yield { row: step.value.row, batchId: 0, status: "skipped" }
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
const send = async (
  client: BrazeClient,
  operation: Operation,
  batch: readonly BulkRecord[],
  batchId: number,
  signal: AbortSignal | undefined,
): Promise<BulkOutcome[]> => {
  const body: Record<string, unknown[]> = {}
  for (const record of batch) {
    const field = body[record.field] ?? []
    field.push(record.value)
    body[record.field] = field
  }

  try {
    const result = await client.execute(operation, { body }, signal ? { signal } : {})

    return batch.map((record) => ({
      row: record.row,
      batchId,
      // Never `success`: Braze accepted the request, and says nothing about the users inside it.
      status: "submitted" as const,
      httpStatus: result.status,
      attempts: result.attempts,
      durationMs: Math.round(result.totalDurationMs),
    }))
  } catch (error) {
    const failure = error instanceof BrazeError ? error : undefined

    // Rule 4 and §24: a connection that died after the request left may well have been processed.
    // Calling that `failed` invites a re-run that double-applies it.
    const status = failure?.code === "outcome_unknown" ? ("unknown" as const) : ("failed" as const)

    return batch.map((record) => ({
      row: record.row,
      batchId,
      status,
      errorCode: failure?.code,
      errorMessage: failure?.message ?? (error instanceof Error ? error.message : String(error)),
    }))
  }
}
