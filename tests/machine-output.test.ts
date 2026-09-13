import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeAll, describe, expect, it } from "vitest"

// The control character is the point: this asserts no ANSI escape reaches a machine stream.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the test
const ANSI = /\u001b\[/

const BINARY = "packages/cli/dist/bin/braze.js"

/**
 * The invariant is about the **process's** stdout, and an in-process test cannot see a stray
 * `console.log` in a dependency or a log destination accidentally pointed at fd 1. So this one
 * runs the built binary for real.
 */
const braze = (args: string[], env: NodeJS.ProcessEnv = {}) => {
  // spawnSync, not execFileSync: the latter returns stdout only, and stderr — the half this
  // test is about — would leak to the parent process instead of being captured.
  const result = spawnSync("node", [BINARY, ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

let configDir: string
let runsDir: string

beforeAll(() => {
  if (!existsSync(BINARY)) throw new Error(`run \`pnpm build\` first — ${BINARY} is missing`)

  configDir = mkdtempSync(join(tmpdir(), "brazecli-e2e-"))
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-e2eruns-"))
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      version: 1,
      credentialStorage: "file",
      defaultProfile: "t",
      profiles: { t: { restEndpoint: "https://rest.iad-01.braze.com", readOnly: false } },
    }),
  )
})

const env = () => ({ BRAZE_CONFIG_DIR: configDir, BRAZE_RUNS_DIR: runsDir, BRAZE_API_KEY: "not-a-real-key" })

describe("the machine-output invariant, on the real binary", () => {
  it("gives exactly one JSON value on stdout and puts the commentary on stderr", () => {
    const result = braze(["api", "POST", "/users/track", "--input", '{"attributes":[]}', "--dry-run", "--json"], env())

    expect(result.code).toBe(0)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true })
    expect(result.stderr).toContain("nothing was sent")
  })

  it("emits no ANSI on either stream", () => {
    const result = braze(["api", "POST", "/users/track", "--input", "{}", "--dry-run", "--json"], env())

    expect(result.stdout).not.toMatch(ANSI)
    expect(result.stderr).not.toMatch(ANSI)
  })

  it("leaves stdout empty when the command refuses", () => {
    const result = braze(["api", "POST", "/users/track", "--input", "{}", "--json"], env())

    expect(result.code).toBe(7)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain("confirmation_required")
  })

  it("keeps stdout clean when a profile cannot be resolved at all", () => {
    const result = braze(["api", "GET", "/campaigns/list", "--json"], {
      BRAZE_CONFIG_DIR: mkdtempSync(join(tmpdir(), "brazecli-empty-")),
    })

    expect(result.code).toBe(3)
    expect(result.stdout).toBe("")
  })

  it("answers --json even without a terminal, and pretty is still available on request", () => {
    const asJson = braze(["runs", "list", "--json"], env())
    expect(() => JSON.parse(asJson.stdout)).not.toThrow()

    const asPretty = braze(["runs", "list", "--output", "pretty"], env())
    expect(asPretty.code).toBe(0)
  })
})
