import { createWriteStream } from "node:fs"
import type { Logger as CoreLogger } from "brazecli-core"
import { pino } from "pino"

/**
 * Fields whose value must never reach a log file. This is the **second** line of defence, not the
 * first: a credential should not be handed to the logger at all. Redaction is what catches the
 * one that slipped into a nested object nobody thought about.
 */
export const REDACTED = [
  "authorization",
  "Authorization",
  "apiKey",
  "api_key",
  "BRAZE_API_KEY",
  "token",
  "accessToken",
  "access_token",
  "password",
]

const REDACT_PATHS = REDACTED.flatMap((field) => [field, `*.${field}`, `*.*.${field}`])

export interface RunLogger extends CoreLogger {
  /** Must be awaited before the process exits, or the tail of the file is lost. */
  close(): Promise<void>
}

export interface CreateLoggerOptions {
  /** Where `events.jsonl` goes. Omit for a logger that writes nowhere. */
  path?: string
  level?: string
  base?: Record<string, unknown>
}

export const createRunLogger = ({ path, level = "info", base = {} }: CreateLoggerOptions = {}): RunLogger => {
  if (!path) return { ...silent, close: async () => {} }

  // A plain append stream, not a worker transport. §66: logging must not need a second process,
  // and `sync: false` would drop the tail of the file when a command exits — which is exactly
  // the failure case the log exists for.
  const file = createWriteStream(path, { flags: "a" })

  const logger = pino(
    {
      level,
      base,
      // No ANSI, ever: this file is grepped and jq'ed, and a colour code breaks both.
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    file,
  )

  return {
    debug: (event, message) => logger.debug(event, message),
    info: (event, message) => logger.info(event, message),
    warn: (event, message) => logger.warn(event, message),
    error: (event, message) => logger.error(event, message),
    close: () =>
      new Promise<void>((resolve) => {
        file.end(() => {
          resolve()
        })
      }),
  }
}

const silent: CoreLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}
