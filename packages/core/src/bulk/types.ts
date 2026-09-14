/**
 * Truthful per-record outcomes (§34 of the brief). **`success` is deliberately absent**: Braze
 * acknowledges a batch, never the users inside it, so the strongest honest word for a record that
 * went out in a batch Braze accepted is `submitted`.
 *
 * `planned`, `invalid` and `skipped` are filled in by later steps — validation and the dry run
 * decide those before or instead of sending.
 */
export type BulkStatus = "planned" | "submitted" | "failed" | "unknown" | "invalid" | "skipped"

export interface BulkRecord {
  /** Source position, 1-based. What ties an outcome back to the input. */
  row: number
  /** Which of the operation's `batch` fields this belongs in — `attributes`, `events`, … */
  field: string
  value: unknown
}

export interface BulkOutcome {
  row: number
  /** Which request carried it. Several rows share one; that is the point of the audit. */
  batchId: number
  status: BulkStatus
  httpStatus?: number
  attempts?: number
  durationMs?: number
  errorCode?: string
  errorMessage?: string
}

export interface BulkProgress {
  records: number
  batches: number
  requests: number
}
