import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import type { Readable } from "node:stream"
import { BrazeError, type BulkRecord, identifiersOf, type Operation } from "brazecli-core"
import { parse } from "csv-parse"

export type RecordsFormat = "jsonl" | "csv"

/**
 * Which format a source is in: what `--records-format` says, or what the file extension says.
 *
 * **Standard input must be told.** There is nothing to read the format from and sniffing the first
 * line would guess — a CSV whose header happens to start with `{` is contrived, but a JSONL file
 * whose first line is blank is not, and a wrong guess sends the whole file into the wrong parser.
 */
export const resolveRecordsFormat = (source: string, given: string | undefined): RecordsFormat => {
  if (given !== undefined) {
    if (given !== "jsonl" && given !== "csv") {
      throw new BrazeError("validation_error", `--records-format takes jsonl or csv, not "${given}"`)
    }
    return given
  }

  const path = source.startsWith("@") ? source.slice(1) : source
  if (path.endsWith(".jsonl") || path.endsWith(".ndjson")) return "jsonl"
  if (path.endsWith(".csv")) return "csv"

  throw new BrazeError(
    "validation_error",
    source === "-"
      ? "reading records from standard input needs --records-format jsonl or --records-format csv"
      : `cannot tell what format ${path} is in — name it with --records-format jsonl or --records-format csv`,
  )
}

export interface RecordsOptions {
  /**
   * Which of the operation's `batch` fields every record of this source belongs in.
   *
   * **Required whenever the operation batches more than one field, and that is not pedantry.**
   * `/users/track` takes `attributes`, `events` and `purchases`; an events file sent into
   * `attributes` passes every check we have — the objects carry an identifier and the schema is
   * loose — and lands in Braze as custom attributes called `name` and `time`. Nothing fails, and
   * 750 000 profiles are quietly wrong. A default would be guessing which file this is.
   */
  field?: string
  /**
   * A key of each record holding the caller's own id for it (`NEED-31`). Absent, the executor
   * generates `<runId>-<row>`.
   *
   * **The key is not removed from the record.** §35 constrains what the audit keeps, not what is
   * sent: taking a field out of the record on its way to Braze would be us editing the caller's
   * data.
   */
  recordIdKey?: string
}

/**
 * Turns a file or standard input into the stream the bulk executor consumes.
 *
 * **Nothing here holds more than one record.** The whole point of §36 is that a two-million-line
 * file never becomes a two-million-element array, and every layer — the line reader, the parser,
 * this generator — hands one record on and forgets it. The executor's demand is what pulls them
 * through, so the file is read at the speed Braze accepts work.
 */
export const readRecords = (
  source: string,
  format: RecordsFormat,
  operation: Operation,
  options: RecordsOptions = {},
): AsyncGenerator<BulkRecord> => recordsFromStream(open(source), format, operation, options)

/**
 * The same, for a stream somebody else opened — standard input, or a test that wants to watch how
 * much of the source is actually consumed. Laziness is the load-bearing property of this module
 * and a claim nobody can check is not a property.
 */
export const recordsFromStream = (
  stream: Readable,
  format: RecordsFormat,
  operation: Operation,
  options: RecordsOptions = {},
): AsyncGenerator<BulkRecord> => {
  const field = fieldFor(operation, options.field)

  return format === "csv" ? fromCsv(stream, field, options) : fromJsonl(stream, field, options)
}

/**
 * `-` is standard input; anything else is a path. A leading `@` is tolerated because `--input`
 * requires one — there it tells a file from inline JSON, and here there is no inline form for it
 * to distinguish, so the alternative is a "cannot open @users.jsonl" that reads like a bug.
 */
const open = (source: string): Readable => {
  if (source === "-") return process.stdin

  const path = source.startsWith("@") ? source.slice(1) : source
  const stream = createReadStream(path)

  stream.on("error", (error) => {
    stream.destroy(new BrazeError("validation_error", `cannot read ${path}: ${error.message}`))
  })

  return stream
}

/**
 * Which array these records go into, and a refusal rather than a guess where it is ambiguous.
 * An operation batching exactly one field has no ambiguity to resolve, so it needs no flag.
 */
const fieldFor = (operation: Operation, given: string | undefined): string => {
  const fields = Object.keys(operation.batch ?? {})

  if (given !== undefined) {
    if (fields.length > 0 && !fields.includes(given)) {
      throw new BrazeError(
        "validation_error",
        `${operation.id} has no batch field "${given}" — it takes ${fields.join(", ")}`,
        { operation: operation.id },
      )
    }
    return given
  }

  if (fields.length === 1) return fields[0] as string

  if (fields.length === 0) {
    throw new BrazeError("validation_error", `${operation.id} does not take records in batches`, {
      operation: operation.id,
    })
  }

  throw new BrazeError(
    "validation_error",
    `${operation.id} batches ${fields.join(", ")} — say which one this file holds with --records-field. ` +
      "Guessing would send an events file into attributes, where every object is accepted and lands as " +
      "custom attributes called name and time.",
    { operation: operation.id },
  )
}

/**
 * One JSON value per line — §28's preferred format, and the only one that streams without a parser
 * holding state across records.
 *
 * Blank lines are skipped rather than counted: a trailing newline is how every text editor ends a
 * file, and an empty last record nobody wrote would be an audit row nobody can act on.
 */
async function* fromJsonl(stream: Readable, field: string, options: RecordsOptions): AsyncGenerator<BulkRecord> {
  let row = 0

  for await (const line of createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY })) {
    if (line.trim() === "") continue
    row += 1

    let value: unknown
    try {
      value = JSON.parse(line)
    } catch (error) {
      throw new BrazeError(
        "validation_error",
        `record ${row} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    yield record(row, field, value, options)
  }
}

/**
 * A header row naming the columns, one record per data row.
 *
 * **`row` counts data records, not lines in the file.** Record 1 is the first row after the
 * header, and a quoted field containing newlines still counts once — so `row` means the same thing
 * here as in a JSONL file or a database cursor, which is what makes a `recordId` comparable across
 * them. A reader who opens the file at that line number will be off by the header and by any
 * embedded newline; that is the price of `row` meaning one thing everywhere.
 *
 * **Every value is a string**, because a CSV cell has no type and inferring one silently changes
 * what Braze stores. The rule that looks clever — treat it as a number when it round-trips — puts
 * two types in one column: `1.5` becomes a number and `1.50` stays a string, decided per row by
 * how somebody formatted a price. A caller who needs real numbers has JSONL. An empty cell is
 * omitted entirely rather than sent as `""`, since a blank in a spreadsheet means "nothing here",
 * never "set this to the empty string".
 */
async function* fromCsv(stream: Readable, field: string, options: RecordsOptions): AsyncGenerator<BulkRecord> {
  const rows = stream.pipe(parse({ columns: true, skip_empty_lines: true, trim: true, bom: true }))
  let row = 0

  for await (const parsed of rows) {
    row += 1

    const value: Record<string, unknown> = {}
    for (const [column, cell] of Object.entries(parsed as Record<string, string>)) {
      if (cell !== "") value[column] = cell
    }

    yield record(row, field, value, options)
  }
}

const record = (row: number, field: string, value: unknown, options: RecordsOptions): BulkRecord => {
  const built: BulkRecord = { row, field, value }

  const own = options.recordIdKey === undefined ? undefined : idFrom(value, options.recordIdKey)
  if (own !== undefined) built.recordId = own

  // Done here rather than in the executor so that a source with its own notion of who a record is
  // about can say so; the executor falls back to reading the value when it finds none.
  const identity = identifiersOf(value)
  if (identity !== undefined) built.identity = identity

  return built
}

const idFrom = (value: unknown, key: string): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined

  const held = (value as Record<string, unknown>)[key]
  if (typeof held === "string") return held
  return typeof held === "number" ? String(held) : undefined
}
