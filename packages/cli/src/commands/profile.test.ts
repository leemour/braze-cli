import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { memoryKeyring } from "../auth/keyring.js"
import { captureStreams } from "../output/stream.js"
import { run } from "../program.js"

let configDir: string
let keyring: ReturnType<typeof memoryKeyring>
let streams: ReturnType<typeof captureStreams>

const braze = (argv: string[], env: NodeJS.ProcessEnv = {}) =>
  run(argv, { env: { BRAZE_CONFIG_DIR: configDir, ...env }, keyring, streams })

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-profile-"))
  keyring = memoryKeyring()
  streams = captureStreams()
})

describe("braze profile", () => {
  it("adds a profile and puts the key in the keyring", async () => {
    const code = await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "prod-key",
    })

    expect(code).toBe(0)
    expect(keyring.entries.get("brazecli:production")).toBe("prod-key")
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual({
      profile: "production",
      restEndpoint: "https://rest.fra-01.braze.eu",
      keyStoredIn: "keyring",
    })
  })

  it("never writes the key into the config file", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "prod-key",
    })

    expect(readFileSync(join(configDir, "config.json"), "utf8")).not.toContain("prod-key")
  })

  it("makes the first profile the default", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "k",
    })
    await braze(["profile", "add", "staging", "--endpoint", "https://rest.iad-03.braze.com"], { BRAZE_API_KEY: "k2" })

    expect(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).defaultProfile).toBe("production")
  })

  it("lists profiles without ever printing a key, masked or otherwise", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "super-secret-key",
    })
    streams.stdout.length = 0

    await braze(["profile", "list"])

    const output = streams.stdout.join("\n")
    // A masked key still confirms which key is installed, so neither the value nor any part of
    // it appears — only whether one exists and where it lives.
    expect(output).not.toContain("super-secret")
    expect(output).not.toContain("secret")
    expect(JSON.parse(output).profiles[0]).toMatchObject({
      name: "production",
      isDefault: true,
      apiKey: { present: true, source: "keyring" },
    })
  })

  it("removes a profile and its key", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], { BRAZE_API_KEY: "k" })

    const code = await braze(["profile", "remove", "production"])

    expect(code).toBe(0)
    expect(keyring.entries.size).toBe(0)
    expect(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).profiles).toEqual({})
  })

  it("exits not_found when asked to remove something that is not there", async () => {
    expect(await braze(["profile", "remove", "nope"])).toBe(6)
    expect(streams.stderr.join("\n")).toMatch(/not_found/)
  })

  it("refuses to invent a key when there is no terminal and no environment", async () => {
    const code = await run(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      keyring,
      streams,
    })

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toMatch(/BRAZE_API_KEY/)
  })

  it("keeps diagnostics off stdout — stdout is data, always", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], { BRAZE_API_KEY: "k" })

    expect(() => JSON.parse(streams.stdout.join("\n"))).not.toThrow()
    expect(streams.stderr.join("\n")).toMatch(/key stored in the keyring/)
  })
})
