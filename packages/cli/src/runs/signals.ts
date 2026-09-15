import type { RunStatus } from "./run.js"

/**
 * What a signal handler needs from a run, and nothing more — so a test can drive this with an
 * object it built rather than a real run directory.
 */
export interface Interruptible {
  /** Stops work in flight. The client turns an aborted signal into `cancelled`, or into
   * `outcome_unknown` for a write that may already have reached Braze. */
  cancel(): void
  /**
   * Work the run has to finish **after** cancelling and **before** the file is finalized.
   *
   * A single request has none: cancelling is the end of it. A bulk run has the part that matters
   * most — the records that never went still need their `skipped` rows, the audit needs closing
   * and the summary is what says how far it got. Exiting the moment the signal arrived would
   * truncate the CSV mid-row and print nothing, which is the failure `BULK-8` names.
   *
   * It may hang, in principle — a request that never answers. That is what the second signal is
   * for, and why this is awaited rather than raced against a timer nobody could pick.
   */
  drain?: () => Promise<void>
  /** Idempotent by construction in `run.ts`, which is what makes this safe to call from a signal. */
  finish(status: RunStatus, extra?: Record<string, unknown>): Promise<void>
}

/**
 * The run a signal will finalize. One at a time: this CLI runs one command per process, and a
 * registry that allowed several would be inventing a case that cannot happen.
 */
let active: Interruptible | undefined
let interrupted = false

export const trackRun = (run: Interruptible): (() => void) => {
  active = run
  return () => {
    if (active === run) active = undefined
  }
}

export interface InterruptOptions {
  /** Injected so a test never has to send a real signal or let the process die. */
  exit?: (code: number) => void
  warn?: (message: string) => void
}

/**
 * Ctrl+C is a phase of the run, not a crash.
 *
 * Without this, a signal kills the process wherever it happens to be and leaves `run.json` saying
 * `"status": "running"` forever — a state `runs list` would have to carry and nobody could
 * interpret. `run.finish` already runs on every other path and is already idempotent, so this is
 * wiring a handler to machinery that exists rather than new machinery.
 *
 * **The second signal exits immediately.** Someone pressing Ctrl+C twice means it, and making them
 * wait for a flush they have already declined is how a tool earns `kill -9`.
 */
export const handleInterrupt = async (signal: NodeJS.Signals, options: InterruptOptions = {}): Promise<void> => {
  const exit = options.exit ?? ((code: number) => process.exit(code))
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`))

  if (interrupted) {
    warn(`${signal} again — exiting now, without finishing the run file`)
    exit(130)
    return
  }
  interrupted = true

  const run = active
  if (!run) {
    exit(130)
    return
  }

  warn(`${signal} — stopping, finishing the run file. Press again to exit immediately.`)
  run.cancel()

  try {
    await run.drain?.()
  } catch {
    // The run's own error handling has already seen this; here it only decides whether we get to
    // write the file, and we still do.
  }

  try {
    await run.finish("cancelled")
  } catch {
    // A failure to write the run file must not replace the exit code the user asked for by
    // pressing Ctrl+C. The log is already closed or already lost either way.
  }
  exit(130)
}

/**
 * Installed once, from the binary — never from `run()`, which tests call hundreds of times and
 * would accumulate a listener per call until Node warns about a leak.
 */
export const installSignalHandlers = (options: InterruptOptions = {}): void => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void handleInterrupt(signal, options)
    })
  }
}

/** Tests share a module, and `interrupted` is module state. */
export const resetInterruptState = (): void => {
  active = undefined
  interrupted = false
}
