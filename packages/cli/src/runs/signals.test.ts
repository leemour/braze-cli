import { beforeEach, describe, expect, it } from "vitest"
import type { RunStatus } from "./run.js"
import { handleInterrupt, installSignalHandlers, resetInterruptState, trackRun } from "./signals.js"

const exits: number[] = []
const warnings: string[] = []
const options = { exit: (code: number) => exits.push(code), warn: (message: string) => warnings.push(message) }

const fakeRun = () => {
  const calls: { cancelled: number; finished: RunStatus[] } = { cancelled: 0, finished: [] }
  return {
    calls,
    cancel: () => {
      calls.cancelled += 1
    },
    finish: async (status: RunStatus) => {
      calls.finished.push(status)
    },
  }
}

beforeEach(() => {
  resetInterruptState()
  exits.length = 0
  warnings.length = 0
})

describe("Ctrl+C during a run", () => {
  /**
   * `CLI-13`. Without this the signal kills the process wherever it happens to be and `run.json`
   * says `"status": "running"` forever — a state `runs list` would have to carry and nobody could
   * interpret.
   */
  it("stops work and finalizes the run file before exiting", async () => {
    const run = fakeRun()
    trackRun(run)

    await handleInterrupt("SIGINT", options)

    expect(run.calls.cancelled).toBe(1)
    expect(run.calls.finished).toEqual(["cancelled"])
    expect(exits).toEqual([130])
  })

  it("says what it is doing, since finishing takes a moment the user did not ask for", async () => {
    trackRun(fakeRun())

    await handleInterrupt("SIGINT", options)

    expect(warnings.join("\n")).toContain("Press again to exit immediately")
  })

  // Someone pressing Ctrl+C twice means it. Making them wait for a flush they have already
  // declined is how a tool earns `kill -9`.
  it("exits at once on a second signal, without waiting for the run file", async () => {
    let finishing = false
    const stubborn = {
      cancel: () => {},
      finish: async () => {
        finishing = true
        await new Promise(() => {})
      },
    }
    trackRun(stubborn)

    void handleInterrupt("SIGINT", options)
    await Promise.resolve()
    await handleInterrupt("SIGINT", options)

    expect(finishing).toBe(true)
    expect(exits).toEqual([130])
    expect(warnings.join("\n")).toContain("without finishing the run file")
  })

  it("exits cleanly when no run had started yet", async () => {
    await handleInterrupt("SIGTERM", options)

    expect(exits).toEqual([130])
  })

  // The exit code the user asked for by pressing Ctrl+C must survive a run file that will not
  // write — a full disk is not a reason to exit 0.
  it("still exits 130 when the run file cannot be written", async () => {
    trackRun({
      cancel: () => {},
      finish: async () => {
        throw new Error("disk full")
      },
    })

    await handleInterrupt("SIGINT", options)

    expect(exits).toEqual([130])
  })

  it("forgets a run once it has finished, so a later signal does not finalize it twice", async () => {
    const run = fakeRun()
    const untrack = trackRun(run)
    untrack()

    await handleInterrupt("SIGINT", options)

    expect(run.calls.finished).toEqual([])
    expect(exits).toEqual([130])
  })
})

/**
 * The handler tests above drive `handleInterrupt` directly. This is the one thing they cannot
 * cover: that a real signal reaches it at all.
 *
 * It asserts the registration rather than sending a signal to a spawned CLI, because that needs
 * `pnpm build` and CI runs `pnpm test` before it — a test that depends on `dist/` is green locally
 * and red in CI for a reason nobody enjoys finding.
 */
describe("installing the handlers", () => {
  it("registers for both signals, so a Ctrl+C and a `kill` behave the same", () => {
    const before = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") }

    installSignalHandlers({ exit: () => {}, warn: () => {} })

    try {
      expect(process.listenerCount("SIGINT")).toBe(before.int + 1)
      expect(process.listenerCount("SIGTERM")).toBe(before.term + 1)
    } finally {
      // Vitest shares a process across files; a leaked listener per run reaches Node's warning.
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        const listeners = process.listeners(signal)
        const last = listeners.at(-1)
        if (last) process.removeListener(signal, last as never)
      }
    }
  })
})

describe("a run with work to wind down", () => {
  /**
   * `BULK-8`. A bulk run's most important rows are written *after* the signal arrives: the records
   * that never went still need their `skipped` rows, the audit needs closing and the summary is
   * what says how far the run got. Finalizing the moment the signal lands truncates the CSV
   * mid-row and prints nothing.
   */
  it("waits for the drain before writing the run file", async () => {
    const order: string[] = []
    let release: (() => void) | undefined

    trackRun({
      cancel: () => order.push("cancel"),
      drain: () =>
        new Promise<void>((resolve) => {
          order.push("drain started")
          release = () => {
            order.push("drain finished")
            resolve()
          }
        }),
      finish: async () => {
        order.push("finish")
      },
    })

    const interrupt = handleInterrupt("SIGINT", options)
    await Promise.resolve()

    expect(order).toEqual(["cancel", "drain started"])
    expect(exits).toEqual([])

    release?.()
    await interrupt

    expect(order).toEqual(["cancel", "drain started", "drain finished", "finish"])
    expect(exits).toEqual([130])
  })

  /** A drain that throws must not cost the run its file — that file is the whole point. */
  it("finalizes anyway when the drain fails", async () => {
    const run = fakeRun()
    trackRun({ ...run, drain: () => Promise.reject(new Error("disk full")) })

    await handleInterrupt("SIGINT", options)

    expect(run.calls.finished).toEqual(["cancelled"])
    expect(exits).toEqual([130])
  })

  /** A single request has nothing to wind down, and must not wait for a drain nobody registered. */
  it("does not wait when there is no drain", async () => {
    const run = fakeRun()
    trackRun(run)

    await handleInterrupt("SIGINT", options)

    expect(run.calls.finished).toEqual(["cancelled"])
  })
})
