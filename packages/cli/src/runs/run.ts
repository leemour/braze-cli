import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { writeSecurely } from "../config/file.js"
import { createRunLogger, type RunLogger } from "../logging/logger.js"

export type RunStatus = "success" | "failed" | "cancelled" | "dry-run"

export interface RunMetadata {
  runId: string
  command: string
  operation?: string
  profile: string
  startedAt: string
  completedAt?: string
  status: RunStatus | "running"
  inputRecords?: number
  submittedRecords?: number
  failedRecords?: number
  unknownRecords?: number
  httpRequests?: number
  httpRetries?: number
  durationMs?: number
  cliVersion: string
  catalogVersion?: string
  /** Never the message of a `BrazeError` alone — the code is what a script reads. */
  errorCode?: string
}

export interface StartRunOptions {
  runsDir: string
  command: string
  operation?: string
  profile: string
  cliVersion: string
  logLevel?: string
  runId?: string
  now?: () => Date
}

export interface Run {
  id: string
  dir: string
  logger: RunLogger
  /**
   * Writes the final `run.json` and closes the log. **Must run on every path** — success, a
   * refusal, a signal. A directory holding `events.jsonl` and no `run.json` is a special case
   * `runs list` would have to carry forever.
   */
  finish(status: RunStatus, extra?: Partial<RunMetadata>): Promise<void>
}

export const startRun = (options: StartRunOptions): Run => {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const id = options.runId ?? runId(startedAt, options.command)
  const dir = join(options.runsDir, startedAt.toISOString().slice(0, 10), id)

  mkdirSync(dir, { recursive: true, mode: 0o700 })

  const logger = createRunLogger({
    path: join(dir, "events.jsonl"),
    level: options.logLevel,
    base: { run_id: id, command: options.command, profile: options.profile },
  })

  const metadata: RunMetadata = {
    runId: id,
    command: options.command,
    operation: options.operation,
    profile: options.profile,
    startedAt: startedAt.toISOString(),
    status: "running",
    cliVersion: options.cliVersion,
  }
  writeRunFile(dir, metadata)

  let finished = false

  return {
    id,
    dir,
    logger,
    finish: async (status, extra = {}) => {
      if (finished) return
      finished = true

      const completedAt = now()
      writeRunFile(dir, {
        ...metadata,
        ...extra,
        status,
        completedAt: completedAt.toISOString(),
        durationMs: completedAt.getTime() - startedAt.getTime(),
      })
      await logger.close()
    },
  }
}

/** `20260913T191500Z-users-track-a81f2c` — sortable, and readable without opening it. */
const runId = (startedAt: Date, command: string): string => {
  const stamp = startedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const slug = command.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
  const suffix = crypto.randomUUID().slice(0, 6)
  return `${stamp}-${slug}-${suffix}`
}

const writeRunFile = (dir: string, metadata: RunMetadata): void => {
  // Atomic, so a reader never sees half a file — and 0600, because the metadata names a profile
  // and an operation even though it carries no key.
  writeSecurely(join(dir, "run.json"), `${JSON.stringify(metadata, null, 2)}\n`, 0o600)
}

export const listRuns = (runsDir: string): RunMetadata[] => {
  const runs: RunMetadata[] = []

  for (const day of safeReaddir(runsDir).sort().reverse()) {
    for (const entry of safeReaddir(join(runsDir, day)).sort().reverse()) {
      const metadata = readRun(join(runsDir, day, entry))
      if (metadata) runs.push(metadata)
    }
  }
  return runs
}

export const findRun = (runsDir: string, id: string): { dir: string; metadata: RunMetadata } | undefined => {
  for (const day of safeReaddir(runsDir)) {
    const dir = join(runsDir, day, id)
    const metadata = readRun(dir)
    if (metadata) return { dir, metadata }
  }
  return undefined
}

const readRun = (dir: string): RunMetadata | undefined => {
  try {
    return JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as RunMetadata
  } catch {
    return undefined
  }
}

const safeReaddir = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
