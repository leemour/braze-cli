import type { BulkRecord } from "./types.js"

/**
 * Where one record sat in the request that carried it.
 *
 * `index` is 0-based **within its own field's array**, because that is how Braze counts: an error
 * entry says `{"index": 3, "input_array": "attributes"}`, and 3 means the fourth attributes object,
 * not the fourth object of the request.
 */
export interface Placement {
  record: BulkRecord
  field: string
  index: number
}

export interface BulkVerdict {
  status: "submitted" | "failed" | "unknown"
  /** Braze's own words for why, when it gave any. */
  errorMessage?: string
  /** Something worth saying about the batch that is not a failure of this record. */
  note?: string
}

/**
 * What became of each record of one batch Braze accepted.
 *
 * **A 2xx is not proof every record landed.** `/users/track` answers 201 with `"message":
 * "success"` and an `errors` array naming the objects it refused — measured 2026-09-15 against the
 * staging workspace, five objects in and three rejected:
 *
 * ```json
 * {"attributes_processed": 2,
 *  "errors": [{"index": 1, "input_array": "attributes", "type": "'email_subscribe' must be …"}, …]}
 * ```
 *
 * **Braze's page documents none of this** — neither `index` nor `input_array` appears on it, and
 * the error object renders as `[ { <error message> } ]`. So every read below is defensive: a shape
 * we do not recognise costs a record its `submitted` and gives it `unknown`, never an exception.
 * Sending must not depend on our being able to parse the answer.
 *
 * Pure, and separate from the executor, so the measured response can be replayed as a fixture
 * rather than re-enacted through HTTP.
 */
export const verdictsFor = (placed: readonly Placement[], body: unknown): Map<number, BulkVerdict> => {
  const verdicts = new Map<number, BulkVerdict>()
  for (const placement of placed) verdicts.set(placement.record.row, { status: "submitted" })

  const answer = asRecord(body)
  if (!answer) return verdicts

  const unplaceable: { field?: string; message: string }[] = []

  for (const entry of Array.isArray(answer.errors) ? answer.errors : []) {
    const reported = asRecord(entry) ?? {}
    const message = typeof reported.type === "string" ? reported.type : JSON.stringify(entry)
    const field = typeof reported.input_array === "string" ? reported.input_array : undefined
    const index = typeof reported.index === "number" ? reported.index : undefined

    const named =
      field !== undefined && index !== undefined
        ? placed.find((placement) => placement.field === field && placement.index === index)
        : undefined

    // An index past the end of what we sent is as unplaceable as no index at all — Braze is
    // talking about something we cannot identify, and guessing which record it meant is the one
    // thing an audit must never do.
    if (named) verdicts.set(named.record.row, { status: "failed", errorMessage: message })
    else unplaceable.push(field === undefined ? { message } : { field, message })
  }

  // An error we cannot tie to a record makes every record it *could* be `unknown`, scoped as
  // narrowly as Braze let us: the named array if there is one, the whole batch if there is not.
  // Never `failed` — naming a record we cannot identify is a lie in the direction that invites a
  // re-run.
  for (const entry of unplaceable) {
    for (const placement of placed) {
      if (entry.field !== undefined && placement.field !== entry.field) continue
      if (verdicts.get(placement.record.row)?.status === "failed") continue

      verdicts.set(placement.record.row, {
        status: "unknown",
        errorMessage: `Braze reported an error it did not tie to a record: ${entry.message}`,
      })
    }
  }

  crossCheckCounts(placed, answer, verdicts)

  return verdicts
}

/**
 * Braze counts what it queued — `attributes_processed`, `events_processed`, `purchases_processed`
 * — and queued plus refused should be everything we sent. The measurement had 2 + 3 = 5.
 *
 * **When the sum does not hold, the records stay `submitted` and carry a note.** The temptation is
 * to call the remainder `unknown`, and that is the wrong way to be wrong: the field is documented
 * as what Braze *queued*, one data point is not an arithmetic guarantee, and a batch where the sum
 * breaks for a benign reason would turn 750 000 truthful rows into `unknown` ones — an audit nobody
 * can act on, from a run where nothing went wrong. `unknown` stays for the two cases with direct
 * evidence behind them: an error we could not place, and a connection that died after sending.
 */
const crossCheckCounts = (
  placed: readonly Placement[],
  answer: Record<string, unknown>,
  verdicts: Map<number, BulkVerdict>,
): void => {
  for (const field of new Set(placed.map((placement) => placement.field))) {
    const processed = answer[`${field}_processed`]
    if (typeof processed !== "number") continue

    const inField = placed.filter((placement) => placement.field === field)
    const refused = inField.filter((placement) => verdicts.get(placement.record.row)?.status === "failed").length
    const unaccounted = inField.length - processed - refused
    if (unaccounted === 0) continue

    const note =
      `Braze queued ${processed} of the ${inField.length} ${field} it was sent and named ${refused} error(s), ` +
      `leaving ${unaccounted} unaccounted for`

    for (const placement of inField) {
      const verdict = verdicts.get(placement.record.row)
      if (verdict && verdict.status !== "failed") verdicts.set(placement.record.row, { ...verdict, note })
    }
  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
