import { BrazeClient, BrazeError, type Operation, resolvePath } from "brazecli-core"
import { assertWriteAllowed } from "./guards.js"
import { createRenderer } from "./output/renderer.js"
import { processStreams, type Streams } from "./output/stream.js"
import { startRun } from "./runs/run.js"
import { type GlobalFlags, type ResolveOptions, resolveSettings } from "./settings.js"
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

    const result = await client.execute(operation, { pathParams: request.pathParams, query, body })

    renderer.result(result.data ?? null)
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
