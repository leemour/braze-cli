import type { BrazeIdentifiers } from "../identity.js"

/**
 * Truthful per-record outcomes (§34 of the brief). **`success` is deliberately absent**: Braze
 * acknowledges a batch, never the users inside it, so the strongest honest word for a record that
 * went out in a batch Braze accepted is `submitted`.
 *
 * `planned` is filled in by a later step — a dry run decides it instead of sending.
 */
export type BulkStatus = "planned" | "submitted" | "failed" | "unknown" | "invalid" | "skipped"

export interface BulkRecord {
  /** Source position, 1-based. What ties an outcome back to the input. */
  row: number
  /**
   * The input's own id for this record, where it carried one. **Optional here and mandatory on the
   * outcome** (`NEED-31`): the executor generates one from the run id where the input gives none,
   * so no parser, cursor or generator can produce a record the audit cannot name.
   */
  recordId?: string
  /** Which of the operation's `batch` fields this belongs in — `attributes`, `events`, … */
  field: string
  value: unknown
  /**
   * Braze's identifiers for the audit. Derived from `value` where a producer does not supply them,
   * and **nothing is removed from `value` either way** — §35 constrains what the audit keeps, not
   * what is sent, and a reduced record would reach Braze as an empty user object.
   */
  identity?: BrazeIdentifiers
}

export interface BulkOutcome {
  row: number
  /**
   * Never blank (`NEED-31`). The input's own id where it had one, `<runId>-<row>` where it did not
   * — unique across every run this tool has ever made, and pointing at both the run directory and
   * the input line.
   */
  recordId: string
  /** So a generated id is never mistaken for a key the customer owns. */
  recordIdSource: "input" | "generated"
  /** Which request carried it. Several rows share one; that is the point of the audit. */
  batchId: number
  status: BulkStatus
  identity?: BrazeIdentifiers
  /**
   * When the request carrying this record was sent, ISO 8601. Taken from the attempt itself rather
   * than worked back from the duration: `totalDurationMs` includes the waiting between retries, so
   * subtracting it would put the start before the request actually left, by as much as the whole
   * backoff. Absent where no request was made.
   */
  startedAt?: string
  httpStatus?: number
  attempts?: number
  durationMs?: number
  errorCode?: string
  errorMessage?: string
  /**
   * Something true about the batch that is not this record's failure — Braze's own counts not
   * adding up, for instance. Kept beside the status rather than folded into it: a run where the
   * numbers look odd is not a run where the records failed, and the audit has to be able to say
   * both things at once.
   */
  note?: string
}

export interface BulkProgress {
  records: number
  batches: number
  requests: number
}
