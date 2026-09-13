import { BrazeError } from "brazecli-core"
import { type CredentialSource, Credentials } from "./auth/credentials.js"
import type { KeyringStore } from "./auth/keyring.js"
import { type Config, loadConfig, type OutputFormat } from "./config/file.js"
import { type Paths, resolvePaths } from "./config/paths.js"

export interface GlobalFlags {
  profile?: string
  json?: boolean
  output?: OutputFormat
  color?: boolean
  runsDir?: string
  timeout?: number
  retries?: number
  dryRun?: boolean
  confirm?: boolean
}

export interface Settings {
  paths: Paths
  config: Config
  profileName: string
  restEndpoint: string
  apiKey: string
  apiKeySource: CredentialSource
  outputFormat: OutputFormat
  color: boolean
  timeoutMs: number | undefined
  retries: number | undefined
  dryRun: boolean
  confirm: boolean
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv
  keyring?: KeyringStore
  isTty?: boolean
  warn?: (message: string) => void
}

/**
 * The hierarchy the brief fixes: **CLI option > environment > profile config > global config >
 * default.** One place, so no command re-derives it and gets the order subtly wrong.
 */
export const resolveSettings = (flags: GlobalFlags, options: ResolveOptions = {}): Settings => {
  const env = options.env ?? process.env
  const paths = resolvePaths(env)
  const config = loadConfig(paths.config)
  if (flags.runsDir) paths.runs = flags.runsDir

  const profileName = flags.profile ?? env.BRAZE_PROFILE ?? config.defaultProfile
  if (!profileName) {
    throw new BrazeError(
      "configuration_error",
      "no profile selected and no default configured — run `braze profile add <name>`",
    )
  }

  const profile = config.profiles[profileName]
  const restEndpoint = env.BRAZE_REST_ENDPOINT ?? profile?.restEndpoint
  if (!restEndpoint) {
    throw new BrazeError(
      "configuration_error",
      profile
        ? `profile "${profileName}" has no REST endpoint`
        : `no profile named "${profileName}" — run \`braze profile list\` to see what exists`,
    )
  }

  const credentials = new Credentials({
    configDir: paths.config,
    storage: config.credentialStorage,
    keyring: options.keyring,
    env,
    warn: options.warn,
  })

  const stored = credentials.read(profileName)
  if (!stored) {
    throw new BrazeError(
      "authentication_error",
      `no API key for profile "${profileName}" — run \`braze profile add ${profileName}\`, or set BRAZE_API_KEY`,
    )
  }

  return {
    paths,
    config,
    profileName,
    restEndpoint,
    apiKey: stored.apiKey,
    apiKeySource: stored.source,
    outputFormat: resolveOutputFormat(flags, env, config, options.isTty ?? process.stdout.isTTY === true),
    color: resolveColor(flags, env, config, options.isTty ?? process.stderr.isTTY === true),
    timeoutMs: flags.timeout ?? config.http.timeoutMs,
    retries: flags.retries ?? config.http.retries,
    dryRun: flags.dryRun === true,
    confirm: flags.confirm === true,
  }
}

/**
 * `NEED-1`: a terminal gets the human renderer, a pipe gets JSON. Kept behind this one function
 * on purpose — if agent traffic ever makes JSON the better default everywhere, that is a
 * one-line change here rather than a rewrite of every command.
 */
export const resolveOutputFormat = (
  flags: GlobalFlags,
  env: NodeJS.ProcessEnv,
  config: Config,
  isTty: boolean,
): OutputFormat => {
  if (flags.json) return "json"
  if (flags.output && flags.output !== "auto") return flags.output

  const fromEnv = env.BRAZE_OUTPUT
  if (fromEnv === "json" || fromEnv === "jsonl" || fromEnv === "pretty") return fromEnv

  const configured = config.output.format
  if (configured && configured !== "auto") return configured

  return isTty ? "pretty" : "json"
}

export const resolveColor = (flags: GlobalFlags, env: NodeJS.ProcessEnv, config: Config, isTty: boolean): boolean => {
  if (flags.color === false) return false
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true

  const configured = config.output.color
  if (configured === "always") return true
  if (configured === "never") return false

  return isTty
}
