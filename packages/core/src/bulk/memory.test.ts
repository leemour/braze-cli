import { describe, expect, it } from "vitest"
import { BrazeClient } from "../client.js"
import { findOperation } from "../operations/index.js"
import { executeBulk } from "./execute.js"
import type { BulkRecord } from "./types.js"

const track = findOperation("users.track.create")
const MILLION = 1_000_000

/**
 * Not `mockBraze`: it keeps every request it was given, which for 13 334 requests of 75 users is a
 * million user objects held alive by the test harness itself. A memory test whose fixture is the
 * biggest thing in the heap measures nothing.
 */
const silent = new BrazeClient({
  endpoint: "https://rest.example.com",
  apiKey: "k",
  fetch: async () => new Response(JSON.stringify({ message: "success" }), { status: 201 }),
})

const million = (state: { pulled: number }) =>
  (async function* (): AsyncGenerator<BulkRecord> {
    for (let row = 1; row <= MILLION; row += 1) {
      state.pulled += 1
      yield { row, field: "attributes", value: { external_id: `u${row}` } }
    }
  })()

describe("a million records", () => {
  /**
   * `BULK-9`, and the test that makes every claim above it more than an intention.
   *
   * **Resident records, counted exactly** — pulled from the source minus handed to the consumer.
   * That is the quantity §36 is about, and unlike heap it has an exact predicted value: at most
   * `concurrency * 2 * batchSize`, which is 600 at the defaults whatever the input size.
   */
  it("never holds more than the bound says, whatever the file size", async () => {
    const state = { pulled: 0 }
    let yielded = 0
    let peak = 0

    for await (const outcome of executeBulk(silent, track as never, million(state), {
      runId: "run",
      concurrency: 4,
    })) {
      yielded += 1
      peak = Math.max(peak, state.pulled - yielded)
      expect(outcome.status).toBe("submitted")
    }

    expect(yielded).toBe(MILLION)
    // Measured 599 against a predicted ceiling of 600, on a million records.
    expect(peak).toBeLessThanOrEqual(4 * 2 * 75)
  }, 120_000)

  /**
   * **The heap half of this lives in the CLI package**, not here: `packages/core` may not touch
   * `process`, and `process.memoryUsage()` is no exception — the ban is what keeps core runnable in
   * a Worker, and a test is not a reason to poke a hole in it. `packages/cli/src/bulk.test.ts`
   * watches the heap through a run that also writes the audit, which is the more honest measurement
   * anyway: it includes the consumer.
   *
   * Measured by hand on 2026-09-15 for the run above: about 44 MB above where it started, against
   * roughly a gigabyte for a pipeline that held the million records.
   */
})
