import { BrazeError } from "./errors.js"
import type { FetchLike } from "./fetch.js"
import { type Logger, noopLogger } from "./logger.js"
import { buildUrl, type HttpMethod, type RequestSpec, resolveEndpoint } from "./request.js"
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
    this.random = options.random ?? Math.random
  }

  get endpoint(): URL {
    return this.#endpoint
  }

  get timeoutMs(): number {
    return this.#timeoutMs
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

    this.#logger.debug({
      event: "http.request",
      request_id: requestId,
      method: spec.method,
      path: url.pathname,
      attempt,
      timeout_ms: this.#timeoutMs,
    })

    const startedAt = this.#now()
    const start = this.#clock()

    void this.#sleep(this.#timeoutMs, finished.signal)
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

    this.#logger.debug({
      event: "http.response",
      request_id: requestId,
      status: response.status,
      attempt,
      duration_ms: Math.round(durationMs),
      rate_limit_remaining: response.headers.get("x-ratelimit-remaining") ?? undefined,
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
    return new BrazeError("network_error", `request failed before a response arrived: ${message}`, details)
  }
}
