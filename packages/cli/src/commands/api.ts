import { BrazeClient, BrazeError, type HttpMethod, rawOperation } from "brazecli-core"
import { Command } from "commander"
import { DOCUMENTATION } from "../documentation.js"
import { assertWriteAllowed } from "../guards.js"
import { readInput } from "../input/read.js"
import { createRenderer } from "../output/renderer.js"
import { processStreams, type Streams } from "../output/stream.js"
import { startRun } from "../runs/run.js"
import { type GlobalFlags, type ResolveOptions, resolveSettings } from "../settings.js"
import { VERSION } from "../version.js"

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]

export interface ApiContext extends ResolveOptions {
  streams?: Streams
  fetch?: typeof globalThis.fetch
}

export const apiCommand = (context: ApiContext = {}): Command =>
  new Command("api")
    .description("send any Braze request, typed or not — the escape hatch")
    .argument("<method>", `one of ${METHODS.join(", ")}`)
    .argument("<path>", "a Braze path such as /campaigns/list — never a whole URL")
    .option("--query <key=value>", "repeatable query parameter", collectQuery, {})
    .option("--input <source>", "request body: @file, - for stdin, or inline JSON")
    .addHelpText(
      "after",
      `\nThis CLI does not yet know which paths exist — that arrives with the generated catalog.\nBraze lists them all here: ${DOCUMENTATION.endpoints}\n`,
    )
    .action(
      async (
        rawMethod: string,
        path: string,
        flags: { query: Record<string, string>; input?: string },
        command: Command,
      ) => {
        const globals = command.parent?.opts<GlobalFlags>() ?? {}
        const streams = context.streams ?? processStreams

        const method = rawMethod.toUpperCase() as HttpMethod
        if (!METHODS.includes(method)) {
          throw new BrazeError(
            "validation_error",
            `unsupported method "${rawMethod}" — use one of ${METHODS.join(", ")}`,
          )
        }

        const settings = resolveSettings(globals, { ...context, warn: context.warn ?? streams.diagnostic })
        const renderer = createRenderer({ format: settings.outputFormat, color: settings.color, streams })
        const operation = rawOperation(method, path)
        const body = flags.input === undefined ? undefined : readInput(flags.input)

        // §14: the method decides. A Braze read that happens to be a POST is corrected by a typed
        // catalog operation, never by guessing here.
        assertWriteAllowed(settings, operation, `${method} ${path}`)

        const run = startRun({
          runsDir: settings.paths.runs,
          command: `api ${method} ${path}`,
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
              method,
              path,
              query: flags.query,
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

          const result = await client.execute(operation, { query: flags.query, body })

          renderer.result(result.data ?? null)
          renderer.success(`${method} ${path} · ${result.status} · ${Math.round(result.totalDurationMs)} ms`)
          await run.finish("success", { httpRequests: result.attempts, httpRetries: result.attempts - 1 })
        } catch (error) {
          // Every path finalizes. A directory with events.jsonl and no run.json is a special case
          // `runs list` would have to carry forever.
          const code = error instanceof BrazeError ? error.code : undefined
          await run.finish(code === "cancelled" ? "cancelled" : "failed", { errorCode: code })
          throw error
        }
      },
    )

const collectQuery = (value: string, previous: Record<string, string>): Record<string, string> => {
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
