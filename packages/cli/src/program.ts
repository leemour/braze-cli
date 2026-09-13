import { BrazeError } from "brazecli-core"
import { Command, Option } from "commander"
import type { KeyringStore } from "./auth/keyring.js"
import { apiCommand } from "./commands/api.js"
import { commandsCommand } from "./commands/commands.js"
import { profileCommand } from "./commands/profile.js"
import { runsCommand } from "./commands/runs.js"
import { OUTPUT_FORMATS } from "./config/file.js"
import { exitCodeFor, GENERIC_FAILURE } from "./exit-codes.js"
import { processStreams, type Streams } from "./output/stream.js"
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

  program.addCommand(profileCommand(options))
  program.addCommand(apiCommand(options))
  program.addCommand(runsCommand(options))
  program.addCommand(commandsCommand(options))

  return program
}

/**
 * Turns any failure into the one exit code a script branches on, and keeps the message on
 * stderr — stdout belongs to data even when everything went wrong.
 */
export const run = async (argv: string[], options: ProgramOptions = {}): Promise<number> => {
  const streams = options.streams ?? processStreams

  try {
    await buildProgram(options).parseAsync(argv, { from: "user" })
    return 0
  } catch (error) {
    if (error instanceof BrazeError) {
      streams.diagnostic(`${error.code}: ${error.message}`)
      return exitCodeFor(error.code)
    }
    if (isCommanderExit(error)) return error.exitCode
    streams.diagnostic(error instanceof Error ? error.message : String(error))
    return GENERIC_FAILURE
  }
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
