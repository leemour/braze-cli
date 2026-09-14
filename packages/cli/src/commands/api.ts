import { BrazeError, findByRequest, type HttpMethod, rawOperation } from "brazecli-core"
import { Command } from "commander"
import { DOCUMENTATION } from "../documentation.js"
import { collectQuery, type ExecutionContext, runOperation } from "../execute.js"
import { readInput } from "../input/read.js"
import type { GlobalFlags } from "../settings.js"

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]

export type ApiContext = ExecutionContext

export const apiCommand = (context: ApiContext = {}): Command =>
  new Command("api")
    .description("send any Braze request, typed or not — the escape hatch")
    .argument("<method>", `one of ${METHODS.join(", ")}`)
    .argument("<path>", "a Braze path such as /campaigns/list — never a whole URL")
    .option("--query <key=value>", "repeatable query parameter", collectQuery, {})
    .option("--input <source>", "request body: @file, - for stdin, or inline JSON")
    .addHelpText(
      "after",
      `\nTyped commands cover the catalog; this reaches anything they do not.\nBraze lists every endpoint here: ${DOCUMENTATION.endpoints}\n`,
    )
    .action(
      async (
        rawMethod: string,
        path: string,
        flags: { query: Record<string, string>; input?: string },
        command: Command,
      ) => {
        const globals = command.parent?.opts<GlobalFlags>() ?? {}

        const method = rawMethod.toUpperCase() as HttpMethod
        if (!METHODS.includes(method)) {
          throw new BrazeError(
            "validation_error",
            `unsupported method "${rawMethod}" — use one of ${METHODS.join(", ")}`,
          )
        }

        // The catalog first: a Braze read implemented as a POST is corrected by its catalog entry
        // (FIND-13), not by guessing here. `rawOperation` remains the escape hatch for every path
        // the catalog does not carry, and judges by method.
        //
        // **The classification is taken; the validation level is not.** §11 of the brief ends with
        // "`braze api` remains the final escape hatch", and a handwritten schema that refuses a
        // request Braze would have accepted must leave the caller somewhere to go. That somewhere
        // is here, so a raw call is always `passthrough` however strict its catalog entry is. The
        // read-only and `--confirm` guards are untouched — those are about whether to send at all.
        const known = findByRequest(method, path)
        const operation = known ? { ...known, validation: "passthrough" as const } : rawOperation(method, path)

        await runOperation(
          {
            operation,
            query: flags.query,
            body: flags.input === undefined ? undefined : readInput(flags.input),
            label: `api ${method} ${path}`,
          },
          globals,
          context,
        )
      },
    )
