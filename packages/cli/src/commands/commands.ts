import type { Command } from "commander"
import { Command as CommanderCommand } from "commander"
import { emptyConfig, loadConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { EXIT_CODES, GENERIC_FAILURE } from "../exit-codes.js"
import { createRenderer } from "../output/renderer.js"
import { processStreams, type Streams } from "../output/stream.js"
import { type GlobalFlags, resolveColor, resolveOutputFormat } from "../settings.js"
import { VERSION } from "../version.js"

export interface CommandsContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
}

interface ArgumentInfo {
  name: string
  required: boolean
  variadic: boolean
  description: string
  choices?: readonly string[]
  default?: unknown
}

interface OptionInfo {
  flags: string
  description: string
  /** False for a plain switch like `--json`, so an agent knows not to look for a value. */
  takesValue: boolean
  /**
   * Whether the option itself must be given. Deliberately not Commander's `required`, which
   * means "takes a value when present" — reading that as "you must pass this" is the obvious
   * misreading, and an agent gets no chance to ask.
   */
  mandatory: boolean
  choices?: readonly string[]
  default?: unknown
  env?: string
}

interface CommandInfo {
  /** What to pass to the CLI, already split: `["runs", "list"]`. */
  path: readonly string[]
  name: string
  description: string
  usage: string
  arguments: readonly ArgumentInfo[]
  options: readonly OptionInfo[]
  commands: readonly CommandInfo[]
}

/**
 * The discovery surface an agent reads instead of `--help`. It walks the live Commander tree
 * rather than a list written by hand, so anything registered later — the generated catalog
 * above all — shows up here without this file being touched.
 */
export const commandsCommand = (context: CommandsContext = {}): Command => {
  const command = new CommanderCommand("commands").description(
    "every command, option and exit code as JSON — the discovery surface for an agent",
  )

  command.action(function (this: Command) {
    const env = context.env ?? process.env
    const root = this.parent ?? this
    const globals = root.opts<GlobalFlags>()

    let config = emptyConfig()
    try {
      config = loadConfig(resolvePaths(env).config)
    } catch {
      // Listing the command surface must not depend on a configuration being readable.
    }

    const format = resolveOutputFormat(globals, env, config, context.isTty ?? process.stdout.isTTY === true)
    const streams = context.streams ?? processStreams
    const renderer = createRenderer({
      format,
      color: resolveColor(globals, env, config, context.isTty ?? process.stderr.isTTY === true),
      streams,
    })

    const commands = root.commands.map((child) => describe(child, root.name(), []))

    if (format === "pretty") {
      renderer.result(flatten(commands).map(({ usage, description }) => ({ command: usage, description })))
      return
    }

    renderer.result({
      cli: root.name(),
      version: VERSION,
      description: root.description(),
      globalOptions: root.options.filter((option) => !option.hidden).map(describeOption),
      commands,
      exitCodes: { ok: 0, generic_failure: GENERIC_FAILURE, ...EXIT_CODES },
    })
  })

  return command
}

const describe = (command: Command, cli: string, parents: readonly string[]): CommandInfo => {
  const path = [...parents, command.name()]
  const args = command.registeredArguments.map(describeArgument)
  const options = command.options.filter((option) => !option.hidden).map(describeOption)

  const usage = [
    cli,
    ...path,
    ...args.map((argument) => (argument.required ? `<${argument.name}>` : `[${argument.name}]`)),
    options.length > 0 ? "[options]" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return {
    path,
    name: command.name(),
    description: command.description(),
    usage,
    arguments: args,
    options,
    commands: command.commands.map((child) => describe(child, cli, path)),
  }
}

const describeArgument = (argument: Command["registeredArguments"][number]): ArgumentInfo => ({
  name: argument.name(),
  required: argument.required,
  variadic: argument.variadic,
  description: argument.description,
  ...(argument.argChoices ? { choices: argument.argChoices } : {}),
  ...(argument.defaultValue === undefined ? {} : { default: argument.defaultValue }),
})

const describeOption = (option: Command["options"][number]): OptionInfo => ({
  flags: option.flags,
  description: option.description,
  takesValue: option.required || option.optional,
  mandatory: option.mandatory,
  ...(option.argChoices ? { choices: option.argChoices } : {}),
  ...(option.defaultValue === undefined ? {} : { default: option.defaultValue }),
  ...(option.envVar ? { env: option.envVar } : {}),
})

const flatten = (commands: readonly CommandInfo[]): CommandInfo[] =>
  commands.flatMap((command) => [command, ...flatten(command.commands)])
