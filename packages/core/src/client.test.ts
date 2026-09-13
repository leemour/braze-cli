import { describe, expect, it, vi } from "vitest"
import { BrazeClient, type BrazeClientOptions } from "./client.js"
import { BrazeError } from "./errors.js"
import { brazeResponses, mockBraze } from "./testing/mock-braze.js"
import { abortError, type SleepLike } from "./time.js"

const ENDPOINT = "https://rest.fra-01.braze.eu"

/** Never settles on its own, so nothing times out — and records the signal so a test can prove
 *  the timer was cancelled rather than left pending. */
const idleTimer = () => {
  const signals: AbortSignal[] = []
  const sleep: SleepLike = (_ms, signal) => {
    if (signal) signals.push(signal)
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(abortError()), { once: true })
    })
  }
  return { sleep, signals }
}

/** Fires the timeout immediately, so a timeout test waits for nothing. */
const instantTimer: SleepLike = () => Promise.resolve()

const clientFor = (braze: ReturnType<typeof mockBraze>, overrides: Partial<BrazeClientOptions> = {}) =>
  new BrazeClient({
    endpoint: ENDPOINT,
    apiKey: "secret-key",
    fetch: braze.fetch,
    sleep: idleTimer().sleep,
    newRequestId: () => "req-1",
    ...overrides,
  })

describe("BrazeClient.send", () => {
  it("sends the method, the path, the key and a JSON body", async () => {
    const braze = mockBraze(brazeResponses.created())

    await clientFor(braze).send({
      method: "POST",
      path: "/users/track",
      body: { attributes: [{ external_id: "u1" }] },
    })

    const request = braze.lastRequest()
    expect(request.method).toBe("POST")
    expect(request.path).toBe("/users/track")
    expect(request.headers.get("authorization")).toBe("Bearer secret-key")
    expect(request.headers.get("content-type")).toBe("application/json")
    expect(request.json()).toEqual({ attributes: [{ external_id: "u1" }] })
  })

  it("sends no body and no content-type when there is nothing to send", async () => {
    const braze = mockBraze(brazeResponses.ok())

    await clientFor(braze).send({ method: "GET", path: "/campaigns/list" })

    expect(braze.lastRequest().body).toBeUndefined()
    expect(braze.lastRequest().headers.get("content-type")).toBeNull()
  })

  it("serializes query parameters and drops the absent ones", async () => {
    const braze = mockBraze(brazeResponses.ok())

    await clientFor(braze).send({
      method: "GET",
      path: "/campaigns/details",
      query: { campaign_id: "abc", page: 2, include: undefined },
    })

    const { query } = braze.lastRequest()
    expect(query.get("campaign_id")).toBe("abc")
    expect(query.get("page")).toBe("2")
    expect(query.has("include")).toBe(false)
  })

  it("substitutes path parameters and escapes them", async () => {
    const braze = mockBraze(brazeResponses.ok())

    await clientFor(braze).send({
      method: "GET",
      path: "/catalogs/{name}/items",
      pathParams: { name: "my catalog/v2" },
    })

    expect(braze.lastRequest().path).toBe("/catalogs/my%20catalog%2Fv2/items")
  })

  it("only sets a user agent when the caller supplies one", async () => {
    const bare = mockBraze(brazeResponses.ok())
    await clientFor(bare).send({ method: "GET", path: "/campaigns/list" })
    expect(bare.lastRequest().headers.get("user-agent")).toBeNull()

    const named = mockBraze(brazeResponses.ok())
    await clientFor(named, { userAgent: "brazecli/0.0.0 runtime/node" }).send({
      method: "GET",
      path: "/campaigns/list",
    })
    expect(named.lastRequest().headers.get("user-agent")).toBe("brazecli/0.0.0 runtime/node")
  })

  it("returns a 500 rather than classifying it — that is execute's job", async () => {
    const braze = mockBraze(brazeResponses.serverError(500))

    const result = await clientFor(braze).send({ method: "GET", path: "/campaigns/list" })

    expect(result.response.status).toBe(500)
  })

  it("times the attempt with the injected monotonic clock and carries the request id", async () => {
    const braze = mockBraze(brazeResponses.ok())
    const ticks = [1000, 1187]

    const result = await clientFor(braze, {
      clock: () => ticks.shift() ?? 0,
      newRequestId: () => "req-42",
    }).send({ method: "GET", path: "/campaigns/list" })

    expect(result.durationMs).toBe(187)
    expect(result.requestId).toBe("req-42")
    expect(result.attempt).toBe(1)
  })

  it("cancels the timeout timer once the response arrives", async () => {
    const braze = mockBraze(brazeResponses.ok())
    const timer = idleTimer()

    await clientFor(braze, { sleep: timer.sleep }).send({ method: "GET", path: "/campaigns/list" })

    // Promise.race does not cancel the loser. Without an explicit abort this is a pending timer
    // per request — invisible here, fatal across ten thousand batches.
    expect(timer.signals).toHaveLength(1)
    expect(timer.signals[0]?.aborted).toBe(true)
  })

  it("logs the request and the response without the key", async () => {
    const braze = mockBraze(brazeResponses.ok())
    const debug = vi.fn()

    await clientFor(braze, { logger: { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() } }).send({
      method: "GET",
      path: "/campaigns/list",
    })

    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ event: "http.request", path: "/campaigns/list" }))
    expect(debug).toHaveBeenCalledWith(expect.objectContaining({ event: "http.response", status: 200 }))
    expect(JSON.stringify(debug.mock.calls)).not.toContain("secret-key")
  })

  describe("when no response arrives", () => {
    it("turns a hung request into a timeout, retryable, with no waiting", async () => {
      const braze = mockBraze(brazeResponses.hangs())

      const failure = await clientFor(braze, { sleep: instantTimer, timeoutMs: 30_000 })
        .send({ method: "GET", path: "/campaigns/list" })
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(BrazeError)
      expect((failure as BrazeError).code).toBe("timeout")
      expect((failure as BrazeError).details.retryable).toBe(true)
    })

    it("distinguishes the caller's cancellation from its own timeout", async () => {
      const braze = mockBraze(brazeResponses.hangs())
      const caller = new AbortController()

      const pending = clientFor(braze)
        .send({ method: "GET", path: "/campaigns/list" }, { signal: caller.signal })
        .catch((error: unknown) => error)
      caller.abort()

      const failure = (await pending) as BrazeError
      expect(failure.code).toBe("cancelled")
      expect(failure.details.retryable).toBe(false)
    })

    it("refuses before sending anything if the caller has already cancelled", async () => {
      const braze = mockBraze(brazeResponses.ok())
      const caller = AbortSignal.abort()

      await expect(
        clientFor(braze).send({ method: "GET", path: "/campaigns/list" }, { signal: caller }),
      ).rejects.toMatchObject({ code: "cancelled" })
      expect(braze.requests).toHaveLength(0)
    })

    it("reports a dropped connection as a network error", async () => {
      const braze = mockBraze(brazeResponses.networkError("ECONNRESET"))

      await expect(clientFor(braze).send({ method: "GET", path: "/campaigns/list" })).rejects.toMatchObject({
        code: "network_error",
      })
    })
  })

  describe("refuses before sending", () => {
    it("an endpoint that is not https", () => {
      expect(() => new BrazeClient({ endpoint: "http://rest.braze.eu", apiKey: "k" })).toThrow(/must be https/)
    })

    it("but allows loopback, which is where a mock server runs", () => {
      expect(() => new BrazeClient({ endpoint: "http://localhost:8787", apiKey: "k" })).not.toThrow()
    })

    it("an empty API key", () => {
      expect(() => new BrazeClient({ endpoint: ENDPOINT, apiKey: "  " })).toThrow(/no Braze API key/)
    })

    it("a whole URL where a path belongs", async () => {
      const braze = mockBraze(brazeResponses.ok())

      await expect(
        clientFor(braze).send({ method: "GET", path: "https://evil.example.com/steal" }),
      ).rejects.toMatchObject({ code: "validation_error" })
      expect(braze.requests).toHaveLength(0)
    })

    it("a path parameter that was never supplied", async () => {
      const braze = mockBraze(brazeResponses.ok())

      await expect(clientFor(braze).send({ method: "GET", path: "/catalogs/{name}" })).rejects.toThrow(
        /needs a value for \{name\}/,
      )
    })

    it("a parameter with no placeholder to go in", async () => {
      const braze = mockBraze(brazeResponses.ok())

      await expect(
        clientFor(braze).send({ method: "GET", path: "/campaigns/list", pathParams: { id: "x" } }),
      ).rejects.toThrow(/no placeholder for: id/)
    })

    it("an array query parameter, because Braze's shape for those is not settled", async () => {
      const braze = mockBraze(brazeResponses.ok())

      await expect(
        clientFor(braze).send({
          method: "GET",
          path: "/campaigns/list",
          query: { ids: ["a", "b"] as unknown as string },
        }),
      ).rejects.toThrow(/not settled yet/)
    })
  })
})
