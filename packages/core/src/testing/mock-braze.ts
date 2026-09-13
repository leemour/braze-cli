import type { FetchLike } from "../fetch.js"
import { abortError } from "../time.js"

/**
 * A scripted stand-in for Braze. Written before `BrazeClient` on purpose: retry, timeout and the
 * ambiguous-write rule are only observable through it, and a mock written afterwards tends to be
 * shaped to match whatever the client already does.
 *
 * Portable like the rest of core — no timers, no randomness, no Node. The one deliberate omission
 * is a "slow but succeeds" response: a real delay in a mock is a sleep in the test suite.
 * `hangsUntilAborted` covers the timeout case without waiting for anything.
 */

/** One scripted reply. At most one failure mode may be set. */
export interface MockResponseSpec {
  status?: number
  /** Serialized as the body, with `content-type: application/json`. */
  json?: unknown
  /** Raw body, used instead of `json`. */
  text?: string
  headers?: Record<string, string>
  /** Claims `application/json` and sends something that is not JSON. */
  invalidJson?: boolean
  /** `fetch` rejects the way a real one does when the connection never carried the request. */
  networkError?: string
  /** The request reached Braze and then the connection died — the ambiguous write. */
  droppedAfterSend?: boolean
  /** Never settles until the caller's `AbortSignal` fires. Produces a timeout with no waiting. */
  hangsUntilAborted?: boolean
}

export interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Headers
  readonly body: string | undefined
  /**
   * Whether the scripted failure happened after Braze would have seen the request.
   *
   * ⚠ **This is for reading a test, never an input to client logic.** A real client cannot know
   * it: a dropped connection looks identical either way. What decides `outcome_unknown` is
   * whether the operation was a write, not whether it arrived.
   */
  readonly reachedServer: boolean
  json(): unknown
}

export type MockScript =
  | MockResponseSpec
  | MockResponseSpec[]
  | ((request: RecordedRequest, index: number) => MockResponseSpec)

export interface MockBraze {
  readonly fetch: FetchLike
  readonly requests: readonly RecordedRequest[]
  /** Calls made after the script ran out. Assert on this rather than on how the mock failed. */
  readonly unexpectedCalls: number
  readonly exhausted: boolean
  lastRequest(): RecordedRequest
}

/**
 * Rejected with when the script runs out. Deliberately not shaped like a network failure: a
 * client that retries more often than the test scripted would otherwise see a plausible error,
 * normalize it, and make the test pass for the wrong reason.
 */
export class MockBrazeExhaustedError extends Error {
  constructor(calls: number) {
    super(`mock Braze was called ${calls} times but the script has fewer responses`)
    this.name = "MockBrazeExhaustedError"
  }
}

const failureModes = ["invalidJson", "networkError", "droppedAfterSend", "hangsUntilAborted"] as const

const assertOneFailureMode = (spec: MockResponseSpec): void => {
  const set = failureModes.filter((mode) => spec[mode] !== undefined)
  if (set.length > 1) {
    throw new Error(`mock Braze response sets more than one failure mode: ${set.join(", ")}`)
  }
}

const record = async (input: string | URL | Request, init: RequestInit | undefined, reachedServer: boolean) => {
  const request = new Request(input as RequestInfo, init)
  const url = new URL(request.url)
  const body = (await request.text()) || undefined

  return {
    method: request.method,
    url: request.url,
    path: url.pathname,
    query: url.searchParams,
    headers: request.headers,
    body,
    reachedServer,
    json: () => {
      if (body === undefined) throw new Error(`${request.method} ${url.pathname} was sent with no body`)
      return JSON.parse(body) as unknown
    },
  } satisfies RecordedRequest
}

const respond = (spec: MockResponseSpec): Response => {
  const headers = new Headers(spec.headers)

  if (spec.invalidJson) {
    headers.set("content-type", "application/json")
    return new Response("<html>502 Bad Gateway</html>", { status: spec.status ?? 200, headers })
  }

  let body: string | null = null
  if (spec.text !== undefined) {
    body = spec.text
  } else if (spec.json !== undefined) {
    body = JSON.stringify(spec.json)
    if (!headers.has("content-type")) headers.set("content-type", "application/json")
  }

  return new Response(body, { status: spec.status ?? 200, headers })
}

const untilAborted = (signal: AbortSignal | null | undefined): Promise<Response> => {
  if (!signal) {
    return Promise.reject(
      new Error("hangsUntilAborted was scripted but the caller passed no AbortSignal — the test would hang"),
    )
  }
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(abortError()), { once: true })
  })
}

export const mockBraze = (script: MockScript): MockBraze => {
  const specs = typeof script === "function" ? script : Array.isArray(script) ? script : [script]
  const requests: RecordedRequest[] = []
  let unexpectedCalls = 0

  const specFor = (request: RecordedRequest, index: number): MockResponseSpec | undefined =>
    typeof specs === "function" ? specs(request, index) : specs[index]

  const fetch: FetchLike = async (input, init) => {
    const index = requests.length + unexpectedCalls
    const peek = await record(input, init, true)
    const spec = specFor(peek, index)

    if (spec === undefined) {
      unexpectedCalls += 1
      throw new MockBrazeExhaustedError(index + 1)
    }
    assertOneFailureMode(spec)

    requests.push(await record(input, init, spec.networkError === undefined))

    if (spec.networkError !== undefined) throw new TypeError(spec.networkError)
    if (spec.droppedAfterSend) throw new TypeError("terminated")
    if (spec.hangsUntilAborted) return untilAborted(init?.signal)

    return respond(spec)
  }

  return {
    fetch,
    requests,
    get unexpectedCalls() {
      return unexpectedCalls
    },
    get exhausted() {
      return unexpectedCalls > 0
    },
    lastRequest() {
      const last = requests.at(-1)
      if (!last) throw new Error("mock Braze received no requests")
      return last
    },
  }
}

/** The shapes Braze actually sends, so a test reads as the situation rather than as a status code. */
export const brazeResponses = {
  ok: (json: unknown = { message: "success" }): MockResponseSpec => ({ status: 200, json }),

  created: (json: unknown = { message: "success" }): MockResponseSpec => ({ status: 201, json }),

  /** Braze puts a human message and an `errors` array in the body of a 4xx. */
  error: (status: number, message: string, errors: unknown[] = []): MockResponseSpec => ({
    status,
    json: { message, errors },
  }),

  unauthorized: (): MockResponseSpec => brazeResponses.error(401, "Invalid API key"),

  forbidden: (): MockResponseSpec => brazeResponses.error(403, "Provided API key not authorized for this endpoint"),

  notFound: (): MockResponseSpec => brazeResponses.error(404, "Resource not found"),

  requestTimeout: (): MockResponseSpec => brazeResponses.error(408, "Request timeout"),

  rateLimited: ({ retryAfterSeconds = 1, remaining = 0, resetAt }: RateLimitOptions = {}): MockResponseSpec => ({
    status: 429,
    json: { message: "Rate limit exceeded" },
    headers: {
      "retry-after": String(retryAfterSeconds),
      "x-ratelimit-remaining": String(remaining),
      ...(resetAt === undefined ? {} : { "x-ratelimit-reset": String(resetAt) }),
    },
  }),

  serverError: (status: 500 | 502 | 503 = 500): MockResponseSpec => ({
    status,
    text: "<html>Internal Server Error</html>",
  }),

  invalidJson: (): MockResponseSpec => ({ invalidJson: true }),

  networkError: (message = "fetch failed"): MockResponseSpec => ({ networkError: message }),

  /** The case §24 of the brief calls critical: Braze may have processed it, and we cannot know. */
  droppedAfterSend: (): MockResponseSpec => ({ droppedAfterSend: true }),

  hangs: (): MockResponseSpec => ({ hangsUntilAborted: true }),
}

export interface RateLimitOptions {
  retryAfterSeconds?: number
  remaining?: number
  /** Unix seconds, as Braze sends it. */
  resetAt?: number
}
