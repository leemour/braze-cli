import { describe, expect, it } from "vitest"
import {
  backoffMs,
  DEFAULT_RETRY,
  parseRateLimitReset,
  parseRetryAfter,
  providerWaitMs,
  retryableStatus,
  statusToCode,
} from "./retry.js"

const at = (iso: string) => () => new Date(iso)

describe("backoff", () => {
  it("is uniform over [0, min(cap, base · 2^n)), which pins the exact waits", () => {
    const half = () => 0.5

    expect(backoffMs(1, DEFAULT_RETRY, half)).toBe(125)
    expect(backoffMs(2, DEFAULT_RETRY, half)).toBe(250)
    expect(backoffMs(3, DEFAULT_RETRY, half)).toBe(500)
  })

  it("never exceeds the cap however many attempts have failed", () => {
    expect(backoffMs(20, DEFAULT_RETRY, () => 1)).toBe(DEFAULT_RETRY.maxDelayMs)
  })

  it("jitters — two clients that failed together do not wake together", () => {
    expect(backoffMs(3, DEFAULT_RETRY, () => 0.1)).toBe(100)
    expect(backoffMs(3, DEFAULT_RETRY, () => 0.9)).toBe(900)
  })
})

describe("what the provider asked for", () => {
  it("reads Retry-After in seconds", () => {
    expect(parseRetryAfter("2", at("2026-09-13T12:00:00Z"))).toBe(2000)
  })

  it("reads Retry-After as an HTTP date, against the injected clock", () => {
    expect(parseRetryAfter("Sun, 13 Sep 2026 12:00:30 GMT", at("2026-09-13T12:00:00Z"))).toBe(30_000)
  })

  it("ignores a date already in the past rather than turning it into a hot loop", () => {
    expect(parseRetryAfter("Sun, 13 Sep 2026 11:59:00 GMT", at("2026-09-13T12:00:00Z"))).toBeUndefined()
  })

  it("ignores a header it cannot read", () => {
    expect(parseRetryAfter("soon", at("2026-09-13T12:00:00Z"))).toBeUndefined()
    expect(parseRetryAfter(null, at("2026-09-13T12:00:00Z"))).toBeUndefined()
  })

  it("reads X-RateLimit-Reset as Unix seconds", () => {
    const now = at("2026-09-13T12:00:00Z")
    const resetAt = Math.floor(new Date("2026-09-13T12:00:05Z").getTime() / 1000)

    expect(parseRateLimitReset(String(resetAt), now)).toBe(5000)
  })

  it("prefers Retry-After when both are present", () => {
    const now = at("2026-09-13T12:00:00Z")
    const headers = new Headers({ "retry-after": "2", "x-ratelimit-reset": "99999999999" })

    expect(providerWaitMs(headers, now)).toBe(2000)
  })
})

describe("classification", () => {
  it("retries only what is safe to repeat", () => {
    expect([408, 429, 500, 502, 503].every(retryableStatus)).toBe(true)
    expect([400, 401, 403, 404, 422].some(retryableStatus)).toBe(false)
  })

  it("maps a status to the code an agent branches on", () => {
    expect(statusToCode(400)).toBe("validation_error")
    expect(statusToCode(401)).toBe("authentication_error")
    expect(statusToCode(403)).toBe("permission_error")
    expect(statusToCode(404)).toBe("not_found")
    expect(statusToCode(408)).toBe("timeout")
    expect(statusToCode(429)).toBe("rate_limited")
    expect(statusToCode(500)).toBe("provider_error")
    expect(statusToCode(503)).toBe("provider_unavailable")
  })
})
