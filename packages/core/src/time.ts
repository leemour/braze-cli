/**
 * The two clocks and the one timer core needs. All three are injectable, which is what makes
 * timeout and backoff testable without anything actually waiting.
 */

/**
 * Why the client is waiting. The real sleep ignores it; a test uses it to tell an attempt's
 * deadline apart from a delay between attempts, which are the only two reasons core ever waits.
 * Without it a test that records waits sees both and cannot assert on either.
 */
export type SleepReason = "timeout" | "retry"

/** Rejects with an `AbortError` if the signal fires first, the way `fetch` does. */
export type SleepLike = (ms: number, signal?: AbortSignal, reason?: SleepReason) => Promise<void>

/** Monotonic milliseconds. Durations come from here; a wall clock can step backwards. */
export type MonotonicClock = () => number

/** Wall time. Timestamps that a person or another system will read come from here. */
export type WallClock = () => Date

export const abortError = (): DOMException => new DOMException("The operation was aborted.", "AbortError")

export const realSleep: SleepLike = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(abortError())
      },
      { once: true },
    )
  })

export const monotonic: MonotonicClock = () => performance.now()

export const wallClock: WallClock = () => new Date()
