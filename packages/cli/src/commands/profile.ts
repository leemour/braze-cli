import { BrazeError } from "brazecli-core"
import { Command } from "commander"
import { Credentials } from "../auth/credentials.js"
import type { KeyringStore } from "../auth/keyring.js"
import { loadConfig, saveConfig } from "../config/file.js"
import { resolvePaths } from "../config/paths.js"
import { processStreams, type Streams } from "../output/stream.js"

export interface ProfileContext {
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  streams?: Streams
  /** How the API key is obtained when the environment does not carry one. */
  promptForKey?: (profile: string) => Promise<string>
}

const context = (options: ProfileContext) => {
  const env = options.env ?? process.env
  const paths = resolvePaths(env)
  const config = loadConfig(paths.config)
  const streams = options.streams ?? processStreams

  const credentials = new Credentials({
    configDir: paths.config,
    storage: config.credentialStorage,
    keyring: options.keyring,
    env,
    warn: streams.diagnostic,
  })

  return { env, paths, config, streams, credentials }
}

export const profileCommand = (options: ProfileContext = {}): Command => {
  const command = new Command("profile").description("manage the Braze environments this CLI talks to")

  command
    .command("add")
    .argument("<name>", "profile name, such as production or staging")
    .requiredOption("--endpoint <url>", "Braze REST endpoint, e.g. https://rest.fra-01.braze.eu")
    .option("--default", "make this the profile used when none is given")
    .option("--read-only", "refuse every write for this profile, whatever flags a command carries")
    .description("add or update a profile and store its API key")
    .action(async (name: string, flags: { endpoint: string; default?: boolean; readOnly?: boolean }) => {
      const { paths, config, streams, credentials, env } = context(options)

      // Never a command line argument: it would land in shell history, in `ps`, and in CI logs.
      const given = env.BRAZE_API_KEY?.trim() || (await askForKey(name, options))

      // Re-running `add` to correct an endpoint must not demand the key again. Keeping the
      // stored one is the obvious reading of "update this profile", and it is said out loud so
      // nobody is left guessing which key is now in use.
      const existing = given ? undefined : credentials.read(name)
      if (!given && !existing) {
        throw new BrazeError(
          "validation_error",
          "no API key given — set BRAZE_API_KEY for this command, or run it in a terminal to be asked",
        )
      }

      config.profiles[name] = { restEndpoint: flags.endpoint, readOnly: flags.readOnly === true }
      if (flags.default || config.defaultProfile === undefined) config.defaultProfile = name
      saveConfig(paths.config, config)

      const storedIn = given ? credentials.write(name, given) : (existing?.source ?? "file")
      streams.diagnostic(
        given
          ? `profile "${name}" saved · key stored in the ${storedIn}`
          : `profile "${name}" updated · keeping the key already in the ${storedIn}`,
      )
      streams.data(
        JSON.stringify({
          profile: name,
          restEndpoint: flags.endpoint,
          keyStoredIn: storedIn,
          keyChanged: Boolean(given),
        }),
      )
    })

  command
    .command("list")
    .description("show the configured profiles")
    .action(() => {
      const { config, streams, credentials } = context(options)

      // Names, endpoints, and whether a key exists. Never the key, and never a masked form of
      // it either — a masked key still confirms which key is installed.
      const rows = Object.entries(config.profiles).map(([name, profile]) => ({
        name,
        restEndpoint: profile.restEndpoint,
        readOnly: profile.readOnly === true,
        isDefault: config.defaultProfile === name,
        apiKey: credentials.read(name) ? { present: true, source: credentials.read(name)?.source } : { present: false },
      }))

      streams.data(JSON.stringify({ profiles: rows, defaultProfile: config.defaultProfile ?? null }))
    })

  command
    .command("remove")
    .argument("<name>", "profile to remove")
    .description("remove a profile and its stored key")
    .action((name: string) => {
      const { paths, config, streams, credentials } = context(options)

      if (config.profiles[name] === undefined) {
        throw new BrazeError("not_found", `no profile named "${name}"`)
      }

      delete config.profiles[name]
      if (config.defaultProfile === name) config.defaultProfile = Object.keys(config.profiles)[0]
      saveConfig(paths.config, config)

      const removedFrom = credentials.remove(name)
      streams.diagnostic(
        removedFrom.length > 0
          ? `removed "${name}" and its key from the ${removedFrom.join(" and ")}`
          : `removed "${name}"`,
      )
      streams.data(JSON.stringify({ removed: name, keyRemovedFrom: removedFrom }))
    })

  return command
}

const askForKey = async (profile: string, options: ProfileContext): Promise<string> => {
  if (options.promptForKey) return options.promptForKey(profile)
  if (!process.stdin.isTTY) return ""

  const { isCancel, password } = await import("@clack/prompts")
  const answer = await password({ message: `Braze API key for "${profile}"` })
  if (isCancel(answer)) throw new BrazeError("cancelled", "cancelled")
  return String(answer)
}
