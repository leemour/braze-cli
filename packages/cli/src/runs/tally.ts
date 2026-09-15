import type { BulkOutcome, BulkStatus } from "brazecli-core"

export interface BulkTally {
  records: number
  batches: number
  requests: number
  retries: number
  byStatus: Record<BulkStatus, number>
}

/**
 * **One count, two readers.** `run.json` and the printed summary are both generated from this, so
 * they cannot disagree — counting twice is how a run reports 749 203 submitted in one place and
 * 749 204 in the other, and then nobody trusts either.
 */
export const newTally = (): BulkTally => ({
  records: 0,
  batches: 0,
  requests: 0,
  retries: 0,
  byStatus: { planned: 0, submitted: 0, failed: 0, unknown: 0, invalid: 0, skipped: 0 },
})

export const count = (tally: BulkTally, outcome: BulkOutcome): void => {
  tally.records += 1
  tally.byStatus[outcome.status] += 1

  // A batch is counted once, when its first record arrives — every record of it carries the same
  // id, and a record that never reached a request carries none.
  if (outcome.batchId > tally.batches) {
    tally.batches = outcome.batchId
    tally.requests += outcome.attempts ?? 1
    tally.retries += (outcome.attempts ?? 1) - 1
  }
}

/**
 * What a bulk run returns.
 *
 * **This is the result, not a diagnostic.** A single request prints Braze's answer; a bulk run has
 * no single answer, so what the caller actually asked — what became of 750 000 records — is this.
 * It goes to stdout in both modes, and `NEED-32` makes it the thing a script branches on, because
 * an exit code cannot carry "612 of 750 000, and here is which".
 */
export interface BulkSummary {
  records: number
  batches: number
  requests: number
  retries: number
  concurrency: number
  durationMs: number
  recordsPerSecond: number
  planned: number
  submitted: number
  failed: number
  unknown: number
  invalid: number
  skipped: number
  recordsFile: string
  dryRun: boolean
  interrupted: boolean
}

export const summarize = (
  tally: BulkTally,
  context: { concurrency: number; durationMs: number; recordsFile: string; dryRun: boolean; interrupted: boolean },
): BulkSummary => ({
  records: tally.records,
  batches: tally.batches,
  requests: tally.requests,
  retries: tally.retries,
  concurrency: context.concurrency,
  durationMs: Math.round(context.durationMs),
  recordsPerSecond: context.durationMs > 0 ? Math.round(tally.records / (context.durationMs / 1000)) : 0,
  ...tally.byStatus,
  recordsFile: context.recordsFile,
  dryRun: context.dryRun,
  interrupted: context.interrupted,
})

/**
 * The same numbers for a person, with a gloss beside each one.
 *
 * **The gloss is not decoration.** A reader who sees only the word `submitted` will take it to mean
 * "it worked", and the whole design exists because that is exactly what nobody can promise: Braze
 * accepted a request carrying this record and acknowledged no user by name.
 */
export const renderSummary = (summary: BulkSummary): string => {
  const head = [
    `${summary.records.toLocaleString("en-US")} records`,
    `${summary.batches.toLocaleString("en-US")} batches`,
    `${summary.concurrency} concurrent`,
    elapsed(summary.durationMs),
    `${summary.recordsPerSecond.toLocaleString("en-US")} records/sec`,
  ].join(" · ")

  const rows: [string, number, string][] = [
    ["planned", summary.planned, "would be sent — nothing left this machine"],
    ["submitted", summary.submitted, "sent in a batch Braze accepted"],
    ["failed", summary.failed, "Braze refused them"],
    ["invalid", summary.invalid, "refused here, before sending — see records.csv for why"],
    ["unknown", summary.unknown, "may have been applied; nobody can say"],
    ["skipped", summary.skipped, "never sent — the run was interrupted"],
  ]

  const lines = rows
    .filter(([, value]) => value > 0)
    .map(([name, value, gloss]) => `  ${name.padEnd(11)} ${String(value).padStart(9)}   ${gloss}`)

  const foot =
    `  ${summary.requests.toLocaleString("en-US")} HTTP requests · ${summary.retries} retries · ` +
    `records.csv has a row for every one of the ${summary.records.toLocaleString("en-US")}`

  return [head, "", ...lines, "", foot].join("\n")
}

const elapsed = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`
}
