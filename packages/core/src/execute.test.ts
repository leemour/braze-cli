import { describe, expect, it, vi } from "vitest"
import { BrazeClient, type BrazeClientOptions } from "./client.js"
import type { BrazeError } from "./errors.js"
import { defineOperation, rawOperation } from "./operation.js"
import { brazeResponses, mockBraze } from "./testing/mock-braze.js"
import { abortError, type SleepLike } from "./time.js"

const ENDPOINT = "https://rest.fra-01.braze.eu"

const campaignList = defineOperation({
  id: "campaigns.list",
  command: ["campaigns", "list"],
  method: "GET",
  path: "/campaigns/list",
  access: "read",
})

const usersTrack = defineOperation({
  id: "users.track",
  command: ["users", "track"],
  method: "POST",
  path: "/users/track",
  access: "write",
  batch: { attributes: 75, events: 75, purchases: 75 },
})

/**
 * Records the delays between attempts and returns from them at once. An attempt's deadline is a
 * different reason to wait and must not fire, or every request in the test times out.
 */
const recordingSleep = () => {
  const waits: number[] = []
  const sleep: SleepLike = (ms, signal, reason) => {
    if (reason === "timeout") return neverSettles(signal)
    waits.push(ms)
    return Promise.resolve()
  }
  return { sleep, waits }
}

const neverSettles = (signal?: AbortSignal): Promise<void> =>
  new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(abortError()), { once: true })
  })

/** Neither times out nor waits — used where the test is not about time at all. */
const idleSleep: SleepLike = (_ms, signal) => neverSettles(signal)

/** Every attempt's deadline fires immediately, so the test is about what a timeout becomes. */
const firesDeadline: SleepLike = (_ms, signal, reason) =>
  reason === "timeout" ? Promise.resolve() : neverSettles(signal)

const clientFor = (braze: ReturnType<typeof mockBraze>, overrides: Partial<BrazeClientOptions> = {}) =>
  new BrazeClient({
    endpoint: ENDPOINT,
    apiKey: "secret-key",
    fetch: braze.fetch,
    sleep: idleSleep,
    random: () => 0.5,
    newRequestId: () => "req-1",
    ...overrides,
  })

describe("BrazeClient.execute", () => {
  it("parses the body and reports the attempt it took", async () => {
    const braze = mockBraze(brazeResponses.ok({ campaigns: [{ id: "c1" }] }))

    const result = await clientFor(braze).execute<{ campaigns: { id: string }[] }>(campaignList)

    expect(result.data.campaigns).toEqual([{ id: "c1" }])
    expect(result.status).toBe(200)
    expect(result.attempts).toBe(1)
    expect(result.retryWaitMs).toBe(0)
  })

  it("keeps the raw body, because a 2xx is not proof every record landed", async () => {
    // Braze answers /users/track with 201 and a populated `errors` array when part of a batch
    // failed. The layer that writes a per-record audit status has to be able to see that.
    const partial = { message: "success", errors: [{ type: "invalid external_id", input_array: "attributes" }] }
    const braze = mockBraze(brazeResponses.created(partial))

    const result = await clientFor(braze).execute(usersTrack, { body: { attributes: [] } })

    expect(result.status).toBe(201)
    expect(JSON.parse(result.raw)).toEqual(partial)
  })

  it("returns nothing rather than failing on an empty body", async () => {
    const braze = mockBraze({ status: 204 })

    expect((await clientFor(braze).execute(campaignList)).data).toBeUndefined()
  })

  it("calls a body that claims JSON and is not an invalid_response", async () => {
    const braze = mockBraze(brazeResponses.invalidJson())

    await expect(clientFor(braze).execute(campaignList)).rejects.toMatchObject({ code: "invalid_response" })
  })

  describe("retrying", () => {
    it("retries a read exactly once by default — two attempts, no more", async () => {
      const braze = mockBraze([brazeResponses.serverError(503), brazeResponses.ok({ campaigns: [] })])
      const timer = recordingSleep()

      const result = await clientFor(braze, { sleep: timer.sleep }).execute(campaignList)

      expect(result.attempts).toBe(2)
      expect(braze.requests).toHaveLength(2)
      expect(braze.unexpectedCalls).toBe(0)
      expect(timer.waits).toEqual([125])
    })

    it("gives up after the configured attempts and reports the last failure", async () => {
      const braze = mockBraze([brazeResponses.serverError(500), brazeResponses.serverError(500)])

      const failure = (await clientFor(braze, { sleep: recordingSleep().sleep })
        .execute(campaignList)
        .catch((error: unknown) => error)) as BrazeError

      expect(failure.code).toBe("provider_error")
      expect(failure.details.attempts).toBe(2)
      expect(failure.details.retryable).toBe(true)
      expect(braze.requests).toHaveLength(2)
    })

    it("never retries a status that would fail again for the same reason", async () => {
      const braze = mockBraze([brazeResponses.unauthorized()])

      await expect(clientFor(braze).execute(campaignList)).rejects.toMatchObject({
        code: "authentication_error",
        details: { retryable: false },
      })
      expect(braze.requests).toHaveLength(1)
    })

    it("never retries a write, because Braze documents no idempotency key", async () => {
      const braze = mockBraze([brazeResponses.serverError(503)])

      await expect(clientFor(braze).execute(usersTrack, { body: {} })).rejects.toMatchObject({
        code: "provider_unavailable",
      })
      expect(braze.requests).toHaveLength(1)
    })

    it("carries Braze's own message rather than a status number", async () => {
      const braze = mockBraze([brazeResponses.error(400, "Invalid app_id")])

      await expect(clientFor(braze).execute(campaignList)).rejects.toThrow("Invalid app_id")
    })
  })

  describe("rate limits", () => {
    it("waits exactly as long as Braze asked, not as long as our backoff says", async () => {
      const braze = mockBraze([brazeResponses.rateLimited({ retryAfterSeconds: 2 }), brazeResponses.ok()])
      const timer = recordingSleep()

      const result = await clientFor(braze, { sleep: timer.sleep }).execute(campaignList)

      expect(result.attempts).toBe(2)
      expect(timer.waits).toEqual([2000])
    })

    it("refuses to block when Braze asks for longer than we are willing to wait", async () => {
      const braze = mockBraze([brazeResponses.rateLimited({ retryAfterSeconds: 120 })])
      const timer = recordingSleep()

      const failure = (await clientFor(braze, { sleep: timer.sleep })
        .execute(campaignList)
        .catch((error: unknown) => error)) as BrazeError

      expect(failure.code).toBe("rate_limited")
      expect(failure.details.retryAfterMs).toBe(120_000)
      expect(failure.details.retryable).toBe(true)
      // Nothing was waited for and nothing was retried — the caller decides, not us.
      expect(timer.waits).toEqual([])
      expect(braze.requests).toHaveLength(1)
    })
  })

  describe("when a write produces no response", () => {
    it("calls a dropped connection unknown, never failed", async () => {
      const braze = mockBraze([brazeResponses.droppedAfterSend()])

      const failure = (await clientFor(braze)
        .execute(usersTrack, { body: { attributes: [] } })
        .catch((error: unknown) => error)) as BrazeError

      expect(failure.code).toBe("outcome_unknown")
      expect(failure.message).toMatch(/may have been processed by Braze/)
      expect(failure.details.operation).toBe("users.track")
    })

    it("marks it not retryable explicitly, not merely absently", async () => {
      const braze = mockBraze([brazeResponses.droppedAfterSend()])

      const failure = (await clientFor(braze)
        .execute(usersTrack, { body: {} })
        .catch((error: unknown) => error)) as BrazeError

      // A caller reading `retryable` as undefined and trying again is the double write this
      // whole state exists to prevent.
      expect(failure.details.retryable).toBe(false)
    })

    it("does the same for a timeout on a write", async () => {
      const braze = mockBraze([brazeResponses.hangs()])

      await expect(clientFor(braze, { sleep: firesDeadline }).execute(usersTrack, { body: {} })).rejects.toMatchObject({
        code: "outcome_unknown",
      })
    })

    it("does the same when the caller cancels a write mid-flight", async () => {
      const braze = mockBraze([brazeResponses.hangs()])
      const caller = new AbortController()

      const pending = clientFor(braze)
        .execute(usersTrack, { body: {} }, { signal: caller.signal })
        .catch((error: unknown) => error)
      caller.abort()

      expect(((await pending) as BrazeError).code).toBe("outcome_unknown")
    })

    it("but a read that timed out is just a timeout, and may be retried", async () => {
      const braze = mockBraze([brazeResponses.hangs(), brazeResponses.ok({ campaigns: [] })])
      let deadlines = 0
      // The first attempt's deadline fires; the second's does not, so the retry can answer.
      const sleep: SleepLike = (_ms, signal, reason) =>
        reason === "timeout" && ++deadlines === 1
          ? Promise.resolve()
          : reason === "retry"
            ? Promise.resolve()
            : neverSettles(signal)

      const result = await clientFor(braze, { sleep }).execute(campaignList)

      expect(result.attempts).toBe(2)
    })

    it("and a cancellation before anything was sent is plainly cancelled", async () => {
      const braze = mockBraze([brazeResponses.ok()])

      await expect(
        clientFor(braze).execute(usersTrack, { body: {} }, { signal: AbortSignal.abort() }),
      ).rejects.toMatchObject({ code: "cancelled" })
      expect(braze.requests).toHaveLength(0)
    })
  })

  describe("raw operations", () => {
    it("treats GET as a read and retries it", async () => {
      const braze = mockBraze([brazeResponses.serverError(500), brazeResponses.ok()])

      const result = await clientFor(braze, { sleep: recordingSleep().sleep }).execute(
        rawOperation("GET", "/campaigns/list"),
      )

      expect(result.attempts).toBe(2)
    })

    it("treats POST as a write and does not", async () => {
      const braze = mockBraze([brazeResponses.serverError(500)])

      await expect(
        clientFor(braze, { sleep: recordingSleep().sleep }).execute(rawOperation("POST", "/users/track"), { body: {} }),
      ).rejects.toMatchObject({ code: "provider_error" })
      expect(braze.requests).toHaveLength(1)
    })
  })

  it("logs the retry with its reason and how long it waited", async () => {
    const braze = mockBraze([brazeResponses.rateLimited({ retryAfterSeconds: 3 }), brazeResponses.ok()])
    const debug = vi.fn()

    await clientFor(braze, {
      sleep: recordingSleep().sleep,
      logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }).execute(campaignList)

    expect(debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: "http.retry", attempt: 2, reason: "rate_limited", wait_ms: 3000 }),
    )
  })
})
