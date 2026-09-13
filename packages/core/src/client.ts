import { BrazeError, type ErrorCode } from "./errors.js"
import type { FetchLike } from "./fetch.js"
import { type Logger, noopLogger } from "./logger.js"
import { mayRetry, type Operation } from "./operation.js"
import { buildUrl, type HttpMethod, type QueryValue, type RequestSpec, resolveEndpoint } from "./request.js"
import {
  backoffMs,
  DEFAULT_RETRY,
  isTransportFailure,
  providerWaitMs,
  type RetryConfig,
  retryableStatus,
  statusToCode,
} from "./retry.js"
import { type MonotonicClock, monotonic, realSleep, type SleepLike, type WallClock, wallClock } from "./time.js"

export const DEFAULT_TIMEOUT_MS = 30_000

export interface BrazeClientOptions {
  /** `https://rest.fra-01.braze.eu`, from the profile. Core never reads this from anywhere. */
  endpoint: string
  apiKey: string
  fetch?: FetchLike
  sleep?: SleepLike
  clock?: MonotonicClock
  now?: WallClock
  random?: () => number
  logger?: Logger
  timeoutMs?: number
  /** Core invents none. The CLI sends `brazecli/<version> …`; a Worker sends its own. */
  userAgent?: string
  newRequestId?: () => string
  retry?: Partial<RetryConfig>
}

export interface OperationInput {
  pathParams?: Record<string, string | number>
  query?: Record<string, QueryValue>
  body?: unknown
}

export interface ExecuteOptions {
  signal?: AbortSignal
  /** Attempts after the first. Overrides the client's configured default for this call. */
  retries?: number
}

export interface ExecuteResult<T = unknown> {
  data: T
  /**
   * The body as Braze sent it. Kept because **a 2xx is not proof every record landed**:
   * `/users/track` answers 201 with a populated `errors` array when some of a batch failed, and
   * the layer that decides a record's audit status has to be able to see that.
   */
  raw: string
  status: number
  headers: Headers
  requestId: string
  attempts: number
  startedAt: Date
  totalDurationMs: number
  /** How much of the total was spent waiting between attempts. */
  retryWaitMs: number
}

export interface SendOptions {
  /** The caller's own cancellation — a bulk run cancels every in-flight request with one. */
  signal?: AbortSignal
  /** Which attempt this is. `execute` sets it; `send` itself never retries. */
  attempt?: number
}

export interface SendResult {
  response: Response
  requestId: string
  method: HttpMethod
  path: string
  url: string
  attempt: number
  startedAt: Date
  durationMs: number
}

export class BrazeClient {
  readonly #endpoint: URL
  readonly #apiKey: string
  readonly #fetch: FetchLike
  readonly #sleep: SleepLike
  readonly #clock: MonotonicClock
  readonly #now: WallClock
  readonly #logger: Logger
  readonly #timeoutMs: number
  readonly #userAgent: string | undefined
  readonly #newRequestId: () => string
  readonly #retry: RetryConfig

  readonly random: () => number

  constructor(options: BrazeClientOptions) {
    if (options.apiKey.trim() === "") {
      throw new BrazeError("configuration_error", "no Braze API key was provided")
    }

    this.#endpoint = resolveEndpoint(options.endpoint)
    this.#apiKey = options.apiKey
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#sleep = options.sleep ?? realSleep
    this.#clock = options.clock ?? monotonic
    this.#now = options.now ?? wallClock
    this.#logger = options.logger ?? noopLogger
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#userAgent = options.userAgent
    this.#newRequestId = options.newRequestId ?? (() => crypto.randomUUID())
    this.#retry = { ...DEFAULT_RETRY, ...options.retry }
    this.random = options.random ?? Math.random
  }

  get endpoint(): URL {
    return this.#endpoint
  }

  /**
   * **Braze echoes the API key back inside its own error messages.** A 401 answers with
   * `Invalid API key: <the key>`, and passing a provider message through verbatim puts the
   * credential on someone's terminal, in their scrollback, and into whatever they paste next.
   * Measured against live Braze on 2026-09-13 (`SEC-1`).
   *
   * The client is the only thing that holds the secret, so it is the only thing that can do
   * this — which is why it happens here and not in a renderer.
   */
  #redact(text: string): string {
    return this.#apiKey.length > 0 ? text.split(this.#apiKey).join("[redacted api key]") : text
  }

  get timeoutMs(): number {
    return this.#timeoutMs
  }

  get retryConfig(): RetryConfig {
    return this.#retry
  }

  /**
   * One attempt. Times out, times itself, logs, and throws only when no HTTP response arrived.
   *
   * **Any HTTP status is a successful send**, 500 included — mapping a status to a `BrazeError`
   * and deciding whether to retry is `execute`'s job, and must not migrate in here. What `send`
   * throws is `timeout`, `cancelled` and `network_error`: the three outcomes where there is no
   * response to classify.
   */
  async send(spec: RequestSpec, options: SendOptions = {}): Promise<SendResult> {
    const attempt = options.attempt ?? 1
    const requestId = this.#newRequestId()
    const url = buildUrl(this.#endpoint, spec)

    const abort = new AbortController()
    // Cancels the timer and removes the caller's abort listener. Without it every request leaves
    // a pending timer and a listener behind, which is invisible at one request and fatal at
    // ten thousand.
    const finished = new AbortController()

    let timedOut = false
    let cancelled = false

    if (options.signal) {
      if (options.signal.aborted) throw new BrazeError("cancelled", "cancelled before the request was sent")
      options.signal.addEventListener(
        "abort",
        () => {
          cancelled = true
          abort.abort()
        },
        { once: true, signal: finished.signal },
      )
    }

    this.#logger.info({
      event: "http.request",
      request_id: requestId,
      method: spec.method,
      path: url.pathname,
      attempt,
      timeout_ms: this.#timeoutMs,
    })

    const startedAt = this.#now()
    const start = this.#clock()

    void this.#sleep(this.#timeoutMs, finished.signal, "timeout")
      .then(() => {
        timedOut = true
        abort.abort()
      })
      .catch(() => {
        // The sleep was cancelled because the response arrived first. Nothing to do.
      })

    let response: Response
    try {
      response = await this.#fetch(url, this.#init(spec, abort.signal))
    } catch (error) {
      throw this.#transportError(error, { requestId, spec, url, attempt, start, timedOut, cancelled })
    } finally {
      finished.abort()
    }

    const durationMs = this.#clock() - start

    this.#logger.info({
      event: "http.response",
      request_id: requestId,
      status: response.status,
      attempt,
      duration_ms: Math.round(durationMs),
      rate_limit_remaining: numberOrUndefined(response.headers.get("x-ratelimit-remaining")),
    })

    return {
      response,
      requestId,
      method: spec.method,
      path: url.pathname,
      url: url.toString(),
      attempt,
      startedAt,
      durationMs,
    }
  }

  /**
   * The policy layer: one or more attempts, classification, and the honest answer when a write's
   * fate cannot be known. This is where retrying is decided — never in `send`.
   */
  async execute<T = unknown>(
    operation: Operation,
    input: OperationInput = {},
    options: ExecuteOptions = {},
  ): Promise<ExecuteResult<T>> {
    // Checked here, so any `cancelled` coming out of `send` below is necessarily one that fired
    // while a request was in flight — which is what makes it ambiguous for a write.
    if (options.signal?.aborted) {
      throw new BrazeError("cancelled", "cancelled before the request was sent", { retryable: false })
    }

    const spec: RequestSpec = { method: operation.method, path: operation.path, ...input }
    const maxAttempts = (options.retries ?? this.#retry.retries) + 1
    const start = this.#clock()

    let attempt = 0
    let retryWaitMs = 0

    for (;;) {
      attempt += 1

      let sent: SendResult
      try {
        sent = await this.send(spec, { signal: options.signal, attempt })
      } catch (error) {
        const failure = error as BrazeError

        if (operation.access === "write" && isTransportFailure(failure.code)) {
          throw this.#outcomeUnknown(operation, failure, attempt)
        }
        if (failure.code !== "cancelled" && mayRetry(operation) && attempt < maxAttempts) {
          retryWaitMs += await this.#waitBeforeRetry(attempt, failure.code, undefined, options.signal)
          continue
        }
        throw failure
      }

      const body = await this.#readBody(sent, operation)

      if (sent.response.ok) {
        return {
          data: this.#parse<T>(body, sent, operation),
          raw: body,
          status: sent.response.status,
          headers: sent.response.headers,
          requestId: sent.requestId,
          attempts: attempt,
          startedAt: sent.startedAt,
          totalDurationMs: this.#clock() - start,
          retryWaitMs,
        }
      }

      const code = statusToCode(sent.response.status)
      const asked = providerWaitMs(sent.response.headers, this.#now)

      const canRetry = retryableStatus(sent.response.status) && mayRetry(operation) && attempt < maxAttempts
      // Braze asking for longer than we are willing to block is not ours to sit out. Hand back a
      // retryable error and let the caller — or a person — decide.
      const askedTooLong = asked !== undefined && asked > this.#retry.maxRetryAfterMs

      if (canRetry && !askedTooLong) {
        retryWaitMs += await this.#waitBeforeRetry(attempt, code, asked, options.signal)
        continue
      }

      throw this.#responseError(code, body, sent, attempt, asked)
    }
  }

  #outcomeUnknown(operation: Operation, failure: BrazeError, attempt: number): BrazeError {
    return new BrazeError(
      "outcome_unknown",
      `the request may have been processed by Braze — it produced no response (${failure.code}) and was not retried`,
      {
        // Explicit, not absent. A caller reading `retryable` as undefined and trying again is the
        // double write this state exists to prevent.
        retryable: false,
        attempts: attempt,
        operation: operation.id,
        requestId: failure.details.requestId,
      },
    )
  }

  async #waitBeforeRetry(
    attempt: number,
    reason: ErrorCode,
    askedMs: number | undefined,
    signal: AbortSignal | undefined,
  ): Promise<number> {
    const waitMs = askedMs ?? backoffMs(attempt, this.#retry, this.random)

    this.#logger.warn({ event: "http.retry", attempt: attempt + 1, reason, wait_ms: Math.round(waitMs) })

    try {
      await this.#sleep(waitMs, signal, "retry")
    } catch {
      throw new BrazeError("cancelled", "cancelled while waiting to retry", { retryable: false, attempts: attempt })
    }
    return waitMs
  }

  async #readBody(sent: SendResult, operation: Operation): Promise<string> {
    try {
      return await sent.response.text()
    } catch (error) {
      throw new BrazeError("invalid_response", this.#redact(`could not read the response body: ${String(error)}`), {
        httpStatus: sent.response.status,
        requestId: sent.requestId,
        operation: operation.id,
      })
    }
  }

  #parse<T>(body: string, sent: SendResult, operation: Operation): T {
    if (body === "") return undefined as T
    try {
      return JSON.parse(body) as T
    } catch {
      throw new BrazeError("invalid_response", `Braze answered ${sent.response.status} with a body that is not JSON`, {
        httpStatus: sent.response.status,
        requestId: sent.requestId,
        operation: operation.id,
      })
    }
  }

  #responseError(
    code: ErrorCode,
    body: string,
    sent: SendResult,
    attempt: number,
    askedMs: number | undefined,
  ): BrazeError {
    return new BrazeError(code, this.#redact(brazeMessage(body) ?? `Braze answered ${sent.response.status}`), {
      httpStatus: sent.response.status,
      retryable: retryableStatus(sent.response.status),
      attempts: attempt,
      requestId: sent.requestId,
      ...(askedMs === undefined ? {} : { retryAfterMs: askedMs }),
    })
  }

  #init(spec: RequestSpec, signal: AbortSignal): RequestInit {
    const headers = new Headers({ authorization: `Bearer ${this.#apiKey}` })
    if (this.#userAgent !== undefined) headers.set("user-agent", this.#userAgent)

    let body: string | undefined
    if (spec.body !== undefined) {
      body = JSON.stringify(spec.body)
      headers.set("content-type", "application/json")
    }

    return { method: spec.method, headers, body, signal }
  }

  #transportError(
    error: unknown,
    context: {
      requestId: string
      spec: RequestSpec
      url: URL
      attempt: number
      start: number
      timedOut: boolean
      cancelled: boolean
    },
  ): BrazeError {
    const details = {
      requestId: context.requestId,
      attempts: context.attempt,
      operation: `${context.spec.method} ${context.url.pathname}`,
    }

    // Both arrive from fetch as an AbortError, so which one it was is tracked by the flag set
    // before aborting — never by inspecting the error.
    if (context.timedOut) {
      return new BrazeError("timeout", `no response after ${this.#timeoutMs} ms`, { ...details, retryable: true })
    }
    if (context.cancelled) {
      return new BrazeError("cancelled", "cancelled by the caller", { ...details, retryable: false })
    }

    const message = error instanceof Error ? error.message : String(error)
    return new BrazeError(
      "network_error",
      this.#redact(`request failed before a response arrived: ${message}`),
      details,
    )
  }
}

/** Headers are strings; the log is read by machines that would rather compare numbers. */
const numberOrUndefined = (value: string | null): number | undefined => {
  if (value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Braze puts a human message in the body of a failure. A proxy's HTML 502 does not. */
const brazeMessage = (body: string): string | undefined => {
  if (body === "") return undefined
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    return typeof parsed.message === "string" ? parsed.message : undefined
  } catch {
    return undefined
  }
}
