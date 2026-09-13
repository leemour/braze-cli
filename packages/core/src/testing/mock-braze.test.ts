import { describe, expect, it } from "vitest"
import { brazeResponses, MockBrazeExhaustedError, mockBraze } from "./mock-braze.js"

const ENDPOINT = "https://rest.fra-01.braze.eu"

describe("mock Braze", () => {
  it("records what was sent, split into the parts a test asserts on", async () => {
    const braze = mockBraze(brazeResponses.ok())

    await braze.fetch(`${ENDPOINT}/users/track?app_id=abc`, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ attributes: [{ external_id: "u1" }] }),
    })

    const request = braze.lastRequest()
    expect(request.method).toBe("POST")
    expect(request.path).toBe("/users/track")
    expect(request.query.get("app_id")).toBe("abc")
    expect(request.headers.get("authorization")).toBe("Bearer secret")
    expect(request.json()).toEqual({ attributes: [{ external_id: "u1" }] })
  })

  it("plays a script in order, so a retry test can script the second attempt", async () => {
    const braze = mockBraze([brazeResponses.rateLimited({ retryAfterSeconds: 2 }), brazeResponses.ok()])

    const first = await braze.fetch(`${ENDPOINT}/campaigns/list`)
    const second = await braze.fetch(`${ENDPOINT}/campaigns/list`)

    expect(first.status).toBe(429)
    expect(first.headers.get("retry-after")).toBe("2")
    expect(second.status).toBe(200)
    expect(braze.requests).toHaveLength(2)
  })

  it("counts calls past the end of the script instead of faking a plausible failure", async () => {
    const braze = mockBraze([brazeResponses.ok()])
    await braze.fetch(`${ENDPOINT}/campaigns/list`)

    await expect(braze.fetch(`${ENDPOINT}/campaigns/list`)).rejects.toBeInstanceOf(MockBrazeExhaustedError)
    expect(braze.unexpectedCalls).toBe(1)
    expect(braze.exhausted).toBe(true)
    // The extra call is not recorded as a request, so `requests.length` stays the count a retry
    // test asserts on.
    expect(braze.requests).toHaveLength(1)
  })

  it("can answer differently depending on what was asked", async () => {
    const braze = mockBraze((request) =>
      request.path === "/users/track" ? brazeResponses.created() : brazeResponses.notFound(),
    )

    expect((await braze.fetch(`${ENDPOINT}/users/track`, { method: "POST", body: "{}" })).status).toBe(201)
    expect((await braze.fetch(`${ENDPOINT}/nope`)).status).toBe(404)
  })

  describe("failure modes", () => {
    it("serves every status the brief names", async () => {
      const statuses = [400, 401, 403, 404, 408, 429, 500, 502, 503]
      const braze = mockBraze(statuses.map((status) => brazeResponses.error(status, "no")))

      for (const status of statuses) {
        expect((await braze.fetch(`${ENDPOINT}/campaigns/list`)).status).toBe(status)
      }
    })

    it("claims JSON and sends something else", async () => {
      const braze = mockBraze(brazeResponses.invalidJson())
      const response = await braze.fetch(`${ENDPOINT}/campaigns/list`)

      expect(response.headers.get("content-type")).toBe("application/json")
      await expect(response.json()).rejects.toThrow()
    })

    it("rejects like a real fetch when the connection never carried the request", async () => {
      const braze = mockBraze(brazeResponses.networkError())

      await expect(braze.fetch(`${ENDPOINT}/campaigns/list`)).rejects.toBeInstanceOf(TypeError)
      expect(braze.lastRequest().reachedServer).toBe(false)
    })

    it("rejects the same way when Braze had already seen it — the ambiguous write", async () => {
      const braze = mockBraze(brazeResponses.droppedAfterSend())

      await expect(braze.fetch(`${ENDPOINT}/users/track`, { method: "POST", body: "{}" })).rejects.toBeInstanceOf(
        TypeError,
      )
      // Indistinguishable from the case above at the fetch boundary. That is the point: what
      // makes this `outcome_unknown` is that it was a write, not that the mock knows it arrived.
      expect(braze.lastRequest().reachedServer).toBe(true)
    })

    it("hangs until the caller aborts, with no clock involved", async () => {
      const braze = mockBraze(brazeResponses.hangs())
      const controller = new AbortController()

      const pending = braze.fetch(`${ENDPOINT}/campaigns/list`, { signal: controller.signal })
      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: "AbortError" })
    })

    it("refuses to hang when no signal was passed, rather than stalling the suite", async () => {
      const braze = mockBraze(brazeResponses.hangs())

      await expect(braze.fetch(`${ENDPOINT}/campaigns/list`)).rejects.toThrow(/no AbortSignal/)
    })

    it("rejects a response that sets two failure modes at once", async () => {
      const braze = mockBraze({ networkError: "boom", hangsUntilAborted: true })

      await expect(braze.fetch(`${ENDPOINT}/campaigns/list`)).rejects.toThrow(/more than one failure mode/)
    })
  })
})
