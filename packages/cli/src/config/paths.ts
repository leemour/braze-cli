import { join } from "node:path"
import envPaths from "env-paths"

export interface Paths {
  /** Where `config.json` and, when the keyring is unavailable, `credentials.json` live. */
  config: string
  /** One directory per invocation that touches Braze. */
  runs: string
}

/**
 * `env-paths` rather than a hand-rolled `~/.config`, so Windows and macOS land in the right
 * place. Both are overridable: a test points them at a temp directory, and `BRAZE_RUNS_DIR`
 * is in the brief so a run's artifacts can be collected somewhere else.
 */
export const resolvePaths = (env: NodeJS.ProcessEnv = process.env): Paths => {
  const base = envPaths("brazecli", { suffix: "" })

  return {
    config: env.BRAZE_CONFIG_DIR ?? base.config,
    runs: env.BRAZE_RUNS_DIR ?? join(base.data, "runs"),
  }
}
