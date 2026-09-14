import { BrazeError } from "brazecli-core"
import { Command, Option } from "commander"
import type { KeyringStore } from "./auth/keyring.js"
import { apiCommand } from "./commands/api.js"
import { catalogCommands } from "./commands/catalog.js"
import { commandsCommand } from "./commands/commands.js"
import { profileCommand } from "./commands/profile.js"
import { runsCommand } from "./commands/runs.js"
import { emptyConfig, loadConfig, OUTPUT_FORMATS } from "./config/file.js"
import { resolvePaths } from "./config/paths.js"
import { DOCUMENTATION } from "./documentation.js"
import { exitCodeFor, GENERIC_FAILURE } from "./exit-codes.js"
import { processStreams, type Streams } from "./output/stream.js"
import { type GlobalFlags, resolveOutputFormat } from "./settings.js"
import { VERSION } from "./version.js"

export interface ProgramOptions {
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  streams?: Streams
  isTty?: boolean
  fetch?: typeof globalThis.fetch
}

export const buildProgram = (options: ProgramOptions = {}): Command => {
  const program = new Command("braze")
    .description("Braze REST API from the command line, for agents and for people")
    .version(VERSION, "-V, --version")
    .option("--profile <name>", "which configured profile to use")
    .option("--json", "one deterministic JSON value on stdout, whatever the terminal is")
    .addOption(new Option("--output <format>", "output mode").choices([...OUTPUT_FORMATS]))
    .option("--no-color", "never emit ANSI colour")
    .option("--dry-run", "resolve, validate and count, but send nothing")
    .option("--confirm", "required before any write; never an interactive prompt")
    .option("--runs-dir <path>", "where run artifacts are written")
    .option("--timeout <ms>", "per-attempt timeout in milliseconds", Number)
    .option("--retries <n>", "attempts after the first", Number)
    .showHelpAfterError()
    .addHelpText(
      "after",
      [
        "",
        "There are no typed commands yet, so every Braze call goes through `braze api`, and you",
        "have to know the path. Braze lists them all here:",
        `  endpoints      ${DOCUMENTATION.endpoints}`,
        `  auth & limits  ${DOCUMENTATION.basics}`,
        "",
        "Writing an agent? `braze commands --json` returns this whole surface, plus the exit code",
        "for every kind of failure, as JSON.",
        "",
      ].join("\n"),
    )

  program.addCommand(profileCommand(options))
  program.addCommand(apiCommand(options))
  program.addCommand(runsCommand(options))
  program.addCommand(commandsCommand(options))

  // §13: registered in a loop, never as a hundred nearly identical files. After the handwritten
  // ones, so a name collision would be visible rather than silently shadowing `profile` or `runs`.
  for (const command of catalogCommands(options)) program.addCommand(command)

  return program
}

/**
 * Turns any failure into the one exit code a script branches on, and keeps the message on
 * stderr — stdout belongs to data even when everything went wrong.
 */
export const run = async (argv: string[], options: ProgramOptions = {}): Promise<number> => {
  const streams = options.streams ?? processStreams
  const program = buildProgram(options)

  try {
    await program.parseAsync(argv, { from: "user" })
    return 0
  } catch (error) {
    if (error instanceof BrazeError) {
      report(program, options, streams, { code: error.code, message: error.message, ...error.details })
      return exitCodeFor(error.code)
    }
    if (isCommanderExit(error)) return error.exitCode

    const message = error instanceof Error ? error.message : String(error)
    report(program, options, streams, { code: "generic_failure", message })
    return GENERIC_FAILURE
  }
}

interface ReportedError {
  code: string
  message: string
  [detail: string]: unknown
}

/**
 * A machine mode gets the failure as JSON, because an exit code says which kind of thing went
 * wrong and nothing about which record or how long to wait. It goes to **stderr**: stdout is
 * data, and an agent reading it must never mistake a refusal for a result.
 */
const report = (program: Command, options: ProgramOptions, streams: Streams, error: ReportedError): void => {
  const env = options.env ?? process.env

  let config = emptyConfig()
  try {
    config = loadConfig(resolvePaths(env).config)
  } catch {
    // Reporting a failure must not depend on the configuration, which may be the failure.
  }

  const isTty = options.isTty ?? process.stdout.isTTY === true
  const format = resolveOutputFormat(program.opts<GlobalFlags>(), env, config, isTty)

  streams.diagnostic(format === "pretty" ? `${error.code}: ${error.message}` : JSON.stringify({ error }))
}

interface CommanderExit {
  code: string
  exitCode: number
}

const isCommanderExit = (error: unknown): error is CommanderExit =>
  typeof error === "object" &&
  error !== null &&
  "exitCode" in error &&
  typeof (error as CommanderExit).exitCode === "number" &&
  String((error as CommanderExit).code).startsWith("commander.")
