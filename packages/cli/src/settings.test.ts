import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { memoryKeyring } from "./auth/keyring.js"
import { emptyConfig, saveConfig } from "./config/file.js"
import { resolveColor, resolveOutputFormat, resolveSettings } from "./settings.js"

const configured = () => {
  const dir = mkdtempSync(join(tmpdir(), "brazecli-settings-"))
  const config = emptyConfig()
  config.profiles.production = { restEndpoint: "https://rest.fra-01.braze.eu" }
  config.profiles.staging = { restEndpoint: "https://rest.iad-03.braze.com" }
  config.defaultProfile = "production"
  saveConfig(dir, config)
  return dir
}

const keyring = () => memoryKeyring({ "brazecli:production": "prod-key", "brazecli:staging": "staging-key" })

const settings = (flags = {}, env: NodeJS.ProcessEnv = {}) =>
  resolveSettings(flags, {
    env: { BRAZE_CONFIG_DIR: configured(), ...env },
    keyring: keyring(),
    isTty: false,
    warn: () => {},
  })

describe("which profile", () => {
  it("takes --profile over everything", () => {
    expect(settings({ profile: "staging" }, { BRAZE_PROFILE: "production" }).profileName).toBe("staging")
  })

  it("then BRAZE_PROFILE", () => {
    expect(settings({}, { BRAZE_PROFILE: "staging" }).profileName).toBe("staging")
  })

  it("then the configured default", () => {
    expect(settings().profileName).toBe("production")
  })

  it("says what to run when the named profile does not exist", () => {
    expect(() => settings({ profile: "nope" })).toThrow(/braze profile list/)
  })
})

describe("endpoint and key", () => {
  it("lets the environment override the configured endpoint", () => {
    expect(settings({}, { BRAZE_REST_ENDPOINT: "https://rest.example.braze.eu" }).restEndpoint).toBe(
      "https://rest.example.braze.eu",
    )
  })

  it("reports where the key came from, so a surprise is visible", () => {
    expect(settings().apiKeySource).toBe("keyring")
    expect(settings({}, { BRAZE_API_KEY: "override" }).apiKeySource).toBe("environment")
  })

  it("says what to run when there is no key at all", () => {
    expect(() =>
      resolveSettings(
        {},
        { env: { BRAZE_CONFIG_DIR: configured() }, keyring: memoryKeyring(), isTty: false, warn: () => {} },
      ),
    ).toThrow(/braze profile add production/)
  })
})

describe("output format — NEED-1", () => {
  const config = emptyConfig()

  it("gives a terminal the human renderer and a pipe JSON", () => {
    expect(resolveOutputFormat({}, {}, config, true)).toBe("pretty")
    expect(resolveOutputFormat({}, {}, config, false)).toBe("json")
  })

  it("lets --json win over a terminal", () => {
    expect(resolveOutputFormat({ json: true }, {}, config, true)).toBe("json")
  })

  it("honours BRAZE_OUTPUT", () => {
    expect(resolveOutputFormat({}, { BRAZE_OUTPUT: "jsonl" }, config, true)).toBe("jsonl")
  })

  it("puts the flag above the environment", () => {
    expect(resolveOutputFormat({ output: "pretty" }, { BRAZE_OUTPUT: "json" }, config, false)).toBe("pretty")
  })
})

describe("colour", () => {
  const config = emptyConfig()

  it("follows the terminal by default", () => {
    expect(resolveColor({}, {}, config, true)).toBe(true)
    expect(resolveColor({}, {}, config, false)).toBe(false)
  })

  it("obeys --no-color and NO_COLOR", () => {
    expect(resolveColor({ color: false }, {}, config, true)).toBe(false)
    expect(resolveColor({}, { NO_COLOR: "1" }, config, true)).toBe(false)
  })

  it("obeys FORCE_COLOR when nothing refuses first", () => {
    expect(resolveColor({}, { FORCE_COLOR: "1" }, config, false)).toBe(true)
  })
})
