import { BrazeClient, BrazeError, type Operation, resolvePath } from "brazecli-core"
import { assertWriteAllowed } from "./guards.js"
import { createRenderer, type Renderer } from "./output/renderer.js"
import { processStreams, type Streams } from "./output/stream.js"
import { startRun } from "./runs/run.js"
import { type GlobalFlags, type ResolveOptions, resolveSettings, type Settings } from "./settings.js"
import { VERSION } from "./version.js"

export interface ExecutionContext extends ResolveOptions {
  streams?: Streams
  fetch?: typeof globalThis.fetch
}

export interface OperationRequest {
  operation: Operation
  pathParams?: Record<string, string>
  query: Record<string, string>
  body?: unknown
  /** What `runs list` shows, e.g. `api GET /campaigns/list` or `campaigns list`. */
  label: string
}

/**
 * One path for every request this CLI makes, whether it came from `braze api` or from a command
 * generated out of the catalog. Shared rather than copied because the things it does in order —
 * refuse a write on a read-only profile, open a run directory, finalize that directory on **every**
 * exit — are the ones that are quietly wrong when a second implementation drifts from the first.
 */
export const runOperation = async (
  request: OperationRequest,
  globals: GlobalFlags,
  context: ExecutionContext,
): Promise<void> => {
  const { operation, query, body, label } = request
  const streams = context.streams ?? processStreams

  const settings = resolveSettings(globals, { ...context, warn: context.warn ?? streams.diagnostic })
  const renderer = createRenderer({ format: settings.outputFormat, color: settings.color, streams })

  const path = resolvePath(operation.path, request.pathParams ?? {})
  assertWriteAllowed(settings, operation, `${operation.method} ${path}`)

  const run = startRun({
    runsDir: settings.paths.runs,
    command: label,
    operation: operation.id,
    profile: settings.profileName,
    cliVersion: VERSION,
    logLevel: context.env?.BRAZE_LOG ?? process.env.BRAZE_LOG,
  })

  try {
    if (settings.dryRun) {
      const plan = {
        dryRun: true,
        profile: settings.profileName,
        endpoint: settings.restEndpoint,
        method: operation.method,
        path,
        query,
        access: operation.access,
        bodyBytes: body === undefined ? 0 : JSON.stringify(body).length,
      }
      run.logger.info({ event: "dry_run", ...plan })
      renderer.result(plan)
      renderer.note("dry run — nothing was sent")
      await run.finish("dry-run")
      return
    }

    const client = new BrazeClient({
      endpoint: settings.restEndpoint,
      apiKey: settings.apiKey,
      logger: run.logger,
      fetch: context.fetch,
      userAgent: `brazecli/${VERSION} runtime/node platform/${process.platform}`,
      ...(settings.timeoutMs === undefined ? {} : { timeoutMs: settings.timeoutMs }),
      ...(settings.retries === undefined ? {} : { retry: { retries: settings.retries } }),
    })

    if (settings.paginate) {
      const walked = await walkPages(client, operation, request, settings, renderer)
      renderer.result(walked.data)
      renderer.note(walked.note)
      renderer.success(`${operation.method} ${path} · ${walked.pages} pages · ${walked.requests} requests`)
      await run.finish("success", { httpRequests: walked.requests, httpRetries: walked.requests - walked.pages })
      return
    }

    const result = await client.execute(operation, { pathParams: request.pathParams, query, body })

    renderer.result(result.data ?? null)

    const page = paginationNote(operation, query, result.data)
    if (page) renderer.note(page)

    renderer.success(`${operation.method} ${path} · ${result.status} · ${Math.round(result.totalDurationMs)} ms`)
    await run.finish("success", { httpRequests: result.attempts, httpRetries: result.attempts - 1 })
  } catch (error) {
    // Every path finalizes. A directory with events.jsonl and no run.json is a special case
    // `runs list` would have to carry forever.
    const code = error instanceof BrazeError ? error.code : undefined
    await run.finish(code === "cancelled" ? "cancelled" : "failed", { errorCode: code })
    throw error
  }
}

/**
 * Braze returns a page with no total and no "next" marker, so a full page and the last page look
 * identical — 100 rows could be all of them or the first of nine. The catalog knows the page size,
 * which is the only thing that tells them apart.
 */
const paginationNote = (operation: Operation, query: Record<string, string>, data: unknown): string | undefined => {
  if (operation.pagination !== "page" || operation.pageSize === undefined) return undefined

  const rows = countRows(data)
  if (rows === undefined) return undefined

  const page = Number.parseInt(query.page ?? "0", 10)
  const shown = Number.isNaN(page) ? 0 : page
  const where = `page ${shown} · ${rows} of at most ${operation.pageSize}`

  return rows < operation.pageSize
    ? `${where} · last page`
    : `${where} · a full page, so there is probably more — try --page ${shown + 1}`
}

const countRows = (data: unknown): number | undefined => {
  if (Array.isArray(data)) return data.length
  if (typeof data !== "object" || data === null) return undefined

  const list = Object.values(data).find((value) => Array.isArray(value))
  return Array.isArray(list) ? list.length : undefined
}

/** Shared by `--query` on `braze api` and on every generated command. */
export const collectQuery = (value: string, previous: Record<string, string>): Record<string, string> => {
  const separator = value.indexOf("=")
  if (separator < 1) {
    throw new BrazeError("validation_error", `--query expects key=value, got "${value}"`)
  }

  const key = value.slice(0, separator)
  if (previous[key] !== undefined) {
    throw new BrazeError(
      "validation_error",
      `--query ${key} was given twice, and how Braze expects repeated parameters is not settled yet (CAT-3) — pass it once`,
    )
  }

  previous[key] = value.slice(separator + 1)
  return previous
}

/**
 * How many pages `--paginate` walks when neither `--max-pages` nor `--max-items` says otherwise.
 *
 * **Bounded by default, deliberately.** An agent that mistypes a filter should not discover it by
 * making nine hundred requests against a workspace with 1.3 million people in it. Ten pages is
 * 1 000 rows at the common page size and 2 500 at the largest Braze documents — enough to be
 * useful, small enough that a mistake is cheap — and the ceiling is always named in the note, so
 * nobody mistakes a truncated walk for the whole list.
 */
export const DEFAULT_MAX_PAGES = 10

interface Walk {
  data: unknown
  pages: number
  requests: number
  note: string
}

/**
 * Walks the pages of a paged read and returns them as ONE value, because stdout carries one JSON
 * value and nothing else (rule 3).
 *
 * The loop lives here, inside `runOperation`, rather than above it: a page walk is **one run** —
 * one run directory, one `run.json`, `httpRequests: 5`. Looping outside would open five run
 * directories for what the caller asked for once, and `runs list` would show five rows for one
 * command.
 */
const walkPages = async (
  client: BrazeClient,
  operation: Operation,
  request: OperationRequest,
  settings: Settings,
  renderer: Renderer,
): Promise<Walk> => {
  if (!operation.pagination || operation.pagination === "none") {
    throw new BrazeError(
      "validation_error",
      `${operation.command.join(" ")} is not paged, so --paginate has nothing to walk. ` +
        "Run it without --paginate, or check `braze schema` for which operations page.",
      { operation: operation.id },
    )
  }
  if (operation.pagination !== "page") {
    throw new BrazeError(
      "validation_error",
      `${operation.command.join(" ")} pages by ${operation.pagination}, which --paginate does not walk yet`,
      { operation: operation.id },
    )
  }

  const maxPages = settings.maxPages ?? (settings.maxItems === undefined ? DEFAULT_MAX_PAGES : Number.POSITIVE_INFINITY)
  const maxItems = settings.maxItems ?? Number.POSITIVE_INFINITY

  const first = Number.parseInt(request.query.page ?? "0", 10)
  const start = Number.isNaN(first) ? 0 : first

  let merged: unknown
  let key: string | undefined
  let rows = 0
  let pages = 0
  let requests = 0
  let stopped = "ran out of pages"

  for (let page = start; pages < maxPages; page += 1) {
    const result = await client.execute(operation, {
      pathParams: request.pathParams,
      query: { ...request.query, page: String(page) },
      body: request.body,
    })

    requests += result.attempts
    pages += 1

    const found = itemsKeyOf(result.data, operation)
    key ??= found
    const items = rowsOf(result.data, key)

    merged = merge(merged, result.data, key, items)
    rows += items.length

    if (operation.pageSize !== undefined && items.length < operation.pageSize) {
      stopped = "reached the last page"
      break
    }
    if (items.length === 0) {
      stopped = "reached an empty page"
      break
    }
    if (rows >= maxItems) {
      stopped = `hit --max-items ${maxItems}`
      break
    }
    if (pages >= maxPages) {
      stopped =
        settings.maxPages === undefined
          ? `hit the default ceiling of ${DEFAULT_MAX_PAGES} pages — pass --max-pages to go further`
          : `hit --max-pages ${settings.maxPages}`
      break
    }
  }

  // The count goes to stderr, never into the payload: stdout stays the shape Braze returned, and
  // an injected `_pages` key would corrupt someone else's response contract.
  renderer.note(`walked ${pages} page${pages === 1 ? "" : "s"} from page ${start}`)

  return { data: merged ?? null, pages, requests, note: `${rows} rows · ${stopped}` }
}

/**
 * Which key holds the rows. Braze answers `{"campaigns":[…],"message":"success"}` rather than a
 * bare array, so something has to say which part accumulates.
 *
 * The single array-valued key is the answer for every paged endpoint Braze documents — verified
 * from their docs for segments (`segments`), custom events (`events`) and product lists
 * (`products`). **Two array keys and no answer is a refusal, not a guess**, because picking the
 * wrong one silently returns a fraction of the data. That is `buildQuery`'s house style for
 * repeated parameters applied to the same class of problem.
 */
const itemsKeyOf = (data: unknown, operation: Operation): string | undefined => {
  if (Array.isArray(data) || typeof data !== "object" || data === null) return undefined

  const arrays = Object.entries(data)
    .filter(([, value]) => Array.isArray(value))
    .map(([name]) => name)

  if (arrays.length > 1) {
    throw new BrazeError(
      "validation_error",
      `${operation.command.join(" ")} returned more than one list (${arrays.join(", ")}), ` +
        "so --paginate cannot tell which one to accumulate. Page through it with --page instead.",
      { operation: operation.id },
    )
  }

  return arrays[0]
}

const rowsOf = (data: unknown, key: string | undefined): readonly unknown[] => {
  if (Array.isArray(data)) return data
  if (key === undefined || typeof data !== "object" || data === null) return []
  const value = (data as Record<string, unknown>)[key]
  return Array.isArray(value) ? value : []
}

/** The last page's other fields win: `message: "success"` from page five is as true as from page one. */
const merge = (into: unknown, page: unknown, key: string | undefined, items: readonly unknown[]): unknown => {
  if (into === undefined) return page
  if (Array.isArray(into)) return [...into, ...items]
  if (key === undefined || typeof page !== "object" || page === null) return page

  return { ...(page as Record<string, unknown>), [key]: [...rowsOf(into, key), ...items] }
}
