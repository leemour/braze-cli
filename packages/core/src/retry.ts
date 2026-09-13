import type { ErrorCode } from "./errors.js"
import type { WallClock } from "./time.js"

export interface RetryConfig {
  /** Attempts after the first. The brief's default is 1, so two attempts in total. */
  retries: number
  baseDelayMs: number
  maxDelayMs: number
  /** Beyond this, we stop waiting and hand back a structured error instead of blocking. */
  maxRetryAfterMs: number
}

export const DEFAULT_RETRY: RetryConfig = {
  retries: 1,
  baseDelayMs: 250,
  maxDelayMs: 10_000,
  maxRetryAfterMs: 30_000,
}

/**
 * Full jitter: the wait is uniform over `[0, min(cap, base · 2^n))`. Picking the exponential
 * value itself synchronizes every client that failed at the same moment, which is the stampede
 * the backoff exists to avoid.
 *
 * `attempt` is the attempt that just failed, counting from 1.
 */
export const backoffMs = (attempt: number, config: RetryConfig, random: () => number): number => {
  const ceiling = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (attempt - 1))
  return Math.round(random() * ceiling)
}

/** `Retry-After` is either a number of seconds or an HTTP date. Both forms occur in the wild. */
export const parseRetryAfter = (header: string | null | undefined, now: WallClock): number | undefined => {
  if (!header) return undefined

  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000

  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return undefined

  const delta = at - now().getTime()
  // A date already in the past would otherwise become a zero wait, and a zero wait against a
  // rate limit is a hot loop.
  return delta > 0 ? delta : undefined
}

/** Braze's `X-RateLimit-Reset` is a Unix timestamp in seconds. */
export const parseRateLimitReset = (header: string | null | undefined, now: WallClock): number | undefined => {
  if (!header) return undefined

  const seconds = Number(header.trim())
  if (!Number.isFinite(seconds)) return undefined

  const delta = seconds * 1000 - now().getTime()
  return delta > 0 ? delta : undefined
}

/** What the provider asked us to wait, if it asked at all. Its timing beats our own backoff. */
export const providerWaitMs = (headers: Headers, now: WallClock): number | undefined =>
  parseRetryAfter(headers.get("retry-after"), now) ?? parseRateLimitReset(headers.get("x-ratelimit-reset"), now)

export const retryableStatus = (status: number): boolean => status === 408 || status === 429 || status >= 500

export const statusToCode = (status: number): ErrorCode => {
  if (status === 400 || status === 422) return "validation_error"
  if (status === 401) return "authentication_error"
  if (status === 403) return "permission_error"
  if (status === 404) return "not_found"
  if (status === 408) return "timeout"
  if (status === 429) return "rate_limited"
  if (status === 502 || status === 503 || status === 504) return "provider_unavailable"
  return "provider_error"
}

/** The three outcomes where no response arrived, and so there is nothing to classify. */
export const isTransportFailure = (code: ErrorCode): boolean =>
  code === "timeout" || code === "network_error" || code === "cancelled"
