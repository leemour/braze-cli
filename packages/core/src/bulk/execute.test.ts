import { describe, expect, it } from "vitest"
import { BrazeClient } from "../client.js"
import { findOperation } from "../operations/index.js"
import { brazeResponses, mockBraze } from "../testing/mock-braze.js"
import { executeBulk } from "./execute.js"
import type { BulkOutcome, BulkRecord } from "./types.js"

const ENDPOINT = "https://rest.fra-01.braze.eu"
const track = findOperation("users.track.create")

const client = (mock: ReturnType<typeof mockBraze>) =>
  new BrazeClient({ endpoint: ENDPOINT, apiKey: "k", fetch: mock.fetch })

/** Counts what the executor actually pulled, which is how backpressure is observed at all. */
const counted = (total: number) => {
  const state = { pulled: 0 }
  const records = async function* (): AsyncGenerator<BulkRecord> {
    for (let row = 1; row <= total; row += 1) {
      state.pulled += 1
      yield { row, field: "attributes", value: { external_id: `u${row}` } }
    }
  }
  return { state, records: records() }
}

const drain = async (outcomes: AsyncIterable<BulkOutcome>): Promise<BulkOutcome[]> => {
  const all: BulkOutcome[] = []
  for await (const outcome of outcomes) all.push(outcome)
  return all
}

describe("batching", () => {
  /**
   * `BUG-8`, as a regression. Braze caps `/users/track` at 75 objects across the three arrays
   * TOGETHER; the per-array 75 is their own legacy limit. Batching by `batch` would put 225 in a
   * request that allows 75 and have every one refused — the whole bulk import, silently.
   */
  it("fills a batch to batchTotal, never to the per-field numbers", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const { records } = counted(150)

    const outcomes = await drain(executeBulk(client(mock), track as never, records, { concurrency: 1 }))

    expect(track?.batchTotal).toBe(75)
    expect(mock.requests).toHaveLength(2)
    expect(outcomes).toHaveLength(150)
  })

  it("gives every record its own outcome, because a batch is transport and the user is not", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const { records } = counted(75)

    const outcomes = await drain(executeBulk(client(mock), track as never, records, { concurrency: 1 }))

    expect(mock.requests).toHaveLength(1)
    expect(outcomes).toHaveLength(75)
    expect(new Set(outcomes.map((outcome) => outcome.batchId))).toEqual(new Set([1]))
    expect(outcomes.map((outcome) => outcome.row)).toEqual([...Array(75)].map((_, i) => i + 1))
  })

  it("sends a short final batch rather than waiting for records that will not come", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const { records } = counted(80)

    await drain(executeBulk(client(mock), track as never, records, { concurrency: 1 }))

    expect(mock.requests).toHaveLength(2)
    expect(JSON.parse(mock.requests[1]?.body as string).attributes).toHaveLength(5)
  })

  it("puts each record in the field it names", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const records = (async function* () {
      yield { row: 1, field: "attributes", value: { external_id: "a" } }
      yield { row: 2, field: "events", value: { name: "e" } }
    })()

    await drain(executeBulk(client(mock), track as never, records, { concurrency: 1 }))

    const body = JSON.parse(mock.requests[0]?.body as string)
    expect(body.attributes).toHaveLength(1)
    expect(body.events).toHaveLength(1)
  })
})

describe("backpressure", () => {
  /**
   * §39: the parser must never enqueue two million promises. The consumer's demand is what
   * advances the source, so a consumer that stops reading stops the file being read — not
   * eventually, but immediately.
   */
  it("stops reading the source while the consumer is not asking", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const { state, records } = counted(100_000)

    const outcomes = executeBulk(client(mock), track as never, records, { concurrency: 2 })

    // Take one outcome and stop. Everything the executor read, it read to get this far.
    const first = await outcomes.next()
    expect(first.done).toBe(false)

    const pulledForOneOutcome = state.pulled
    // concurrency 2 → at most 4 batches outstanding at once, queued, running or waiting to be
    // yielded → at most 4 × 75 records ever read, out of a hundred thousand.
    expect(pulledForOneOutcome).toBeLessThanOrEqual(4 * 75)
    expect(pulledForOneOutcome).toBeLessThan(100_000)

    await outcomes.return(undefined as never)
  })

  it("never runs more requests at once than it was told to", async () => {
    let inFlight = 0
    let peak = 0
    const mock = mockBraze(() => brazeResponses.created())
    // The delay goes here rather than in the mock's script, which must return a spec and not a
    // promise — an async script silently becomes a Promise where a response was expected.
    const slow = new BrazeClient({
      endpoint: ENDPOINT,
      apiKey: "k",
      fetch: async (input, init) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return mock.fetch(input, init)
      },
    })
    const { records } = counted(750)

    await drain(executeBulk(slow, track as never, records, { concurrency: 3 }))

    expect(mock.requests).toHaveLength(10)
    expect(peak).toBeLessThanOrEqual(3)
  })

  it("closes the source when the consumer walks away mid-run", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    let closed = false
    const records = (async function* () {
      try {
        for (let row = 1; row <= 10_000; row += 1) yield { row, field: "attributes", value: { external_id: "u" } }
      } finally {
        closed = true
      }
    })()

    const outcomes = executeBulk(client(mock), track as never, records, { concurrency: 1 })
    await outcomes.next()
    await outcomes.return(undefined as never)

    expect(closed).toBe(true)
  })
})

describe("what an outcome says happened", () => {
  it("calls an accepted batch submitted, never success — Braze acknowledges no user by name", async () => {
    const mock = mockBraze(() => brazeResponses.created())
    const { records } = counted(3)

    const outcomes = await drain(executeBulk(client(mock), track as never, records, { concurrency: 1 }))

    expect(outcomes.every((outcome) => outcome.status === "submitted")).toBe(true)
    expect(outcomes[0]?.httpStatus).toBe(201)
  })

  it("marks every record of a refused batch failed, with the code a script can branch on", async () => {
    const mock = mockBraze(() => brazeResponses.error(400, "Bad Request"))
    const { records } = counted(3)

    const outcomes = await drain(executeBulk(client(mock), track as never, records, { concurrency: 1 }))

    expect(outcomes).toHaveLength(3)
    expect(outcomes.every((outcome) => outcome.status === "failed")).toBe(true)
    expect(outcomes[0]?.errorCode).toBeTruthy()
  })

  /**
   * Rule 4 and §24. The request left; the connection died before the answer came back. Braze may
   * well have applied it, and calling that `failed` invites a re-run that double-applies.
   */
  it("calls a write whose outcome nobody knows unknown, not failed", async () => {
    const mock = mockBraze(() => brazeResponses.droppedAfterSend())
    const { records } = counted(2)

    const outcomes = await drain(executeBulk(client(mock), track as never, records, { concurrency: 1 }))

    expect(outcomes.every((outcome) => outcome.status === "unknown")).toBe(true)
    expect(outcomes[0]?.errorCode).toBe("outcome_unknown")
  })
})

describe("cancellation", () => {
  it("stops scheduling and reports what never went as skipped", async () => {
    const controller = new AbortController()
    const mock = mockBraze(() => {
      controller.abort()
      return brazeResponses.created()
    })
    const { records } = counted(500)

    const outcomes = await drain(
      executeBulk(client(mock), track as never, records, { concurrency: 1, signal: controller.signal }),
    )

    const skipped = outcomes.filter((outcome) => outcome.status === "skipped")
    expect(skipped.length).toBeGreaterThan(0)
    expect(outcomes).toHaveLength(500)
    // Everything is accounted for: nothing silently disappears when a run is interrupted.
    expect(new Set(outcomes.map((outcome) => outcome.row)).size).toBe(500)
  })
})
