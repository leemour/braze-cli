import { BrazeError } from "brazecli-core"
import { Command } from "commander"
import { emptyConfig, loadConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { createRenderer } from "../output/renderer.js"
import { processStreams, type Streams } from "../output/stream.js"
import { findRun, listRuns } from "../runs/run.js"
import { type GlobalFlags, resolveColor, resolveOutputFormat } from "../settings.js"

export interface RunsContext {
  env?: NodeJS.ProcessEnv
  streams?: Streams
  isTty?: boolean
}

/**
 * Reads run artifacts. Deliberately needs no profile and no key: the whole point is to be able
 * to look at what happened after something went wrong with the configuration.
 */
export const runsCommand = (context: RunsContext = {}): Command => {
  const command = new Command("runs").description("inspect what past invocations did")

  const setup = (parent: Command) => {
    const env = context.env ?? process.env
    const globals = parent.parent?.parent?.opts<GlobalFlags>() ?? parent.parent?.opts<GlobalFlags>() ?? {}
    const paths = resolvePaths(env)
    if (globals.runsDir) paths.runs = globals.runsDir

    let config = emptyConfig()
    try {
      config = loadConfig(paths.config)
    } catch {
      // A broken config must not stop someone reading the logs that would explain it.
    }

    const streams = context.streams ?? processStreams
    return {
      paths,
      streams,
      renderer: createRenderer({
        format: resolveOutputFormat(globals, env, config, context.isTty ?? process.stdout.isTTY === true),
        color: resolveColor(globals, env, config, context.isTty ?? process.stderr.isTTY === true),
        streams,
      }),
    }
  }

  command
    .command("list")
    .option("--limit <n>", "how many to show, newest first", Number, 20)
    .description("list past runs, newest first")
    .action(function (this: Command, flags: { limit: number }) {
      const { paths, renderer } = setup(this)
      const runs = listRuns(paths.runs).slice(0, flags.limit)

      renderer.result(
        runs.map((run) => ({
          runId: run.runId,
          command: run.command,
          profile: run.profile,
          status: run.status,
          startedAt: run.startedAt,
          durationMs: run.durationMs ?? null,
        })),
      )
    })

  command
    .command("show")
    .argument("<run-id>")
    .description("everything recorded about one run")
    .action(function (this: Command, id: string) {
      const { paths, renderer } = setup(this)
      const found = findRun(paths.runs, id)
      if (!found) throw new BrazeError("not_found", `no run named "${id}" under ${paths.runs}`)

      renderer.result({ ...found.metadata, directory: found.dir })
    })

  command
    .command("path")
    .argument("<run-id>")
    .description("the directory holding a run's artifacts")
    .action(function (this: Command, id: string) {
      const { paths, streams } = setup(this)
      const found = findRun(paths.runs, id)
      if (!found) throw new BrazeError("not_found", `no run named "${id}" under ${paths.runs}`)

      // A bare path, so it composes: `cat "$(braze runs path <id>)/events.jsonl"`.
      streams.data(found.dir)
    })

  return command
}
