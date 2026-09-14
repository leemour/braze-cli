import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { keyringService } from "../auth/credentials.js"
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
    expect(keyring.entries.get(`${keyringService(configDir, { BRAZE_CONFIG_DIR: configDir })}:production`)).toBe(
      "prod-key",
    )
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual({
      profile: "production",
      restEndpoint: "https://rest.fra-01.braze.eu",
      readOnly: false,
      keyStoredIn: "keyring",
      keyChanged: true,
    })
  })

  // BUG-5 and UX-3. Updating one field used to mean re-supplying every field, and the endpoint
  // got retyped as `rest.fra-01.braze.com` — a host that does not exist, so nothing worked at
  // all until someone noticed.
  describe("updating one field of an existing profile", () => {
    const add = (args: string[]) => braze(["profile", "add", "production", ...args], { BRAZE_API_KEY: "prod-key" })
    const written = () => JSON.parse(streams.stdout.join("\n").trim().split("\n").at(-1) as string)

    beforeEach(async () => {
      await add(["--endpoint", "https://rest.fra-01.braze.eu", "--read-only"])
      streams.stdout.length = 0
    })

    it("turns writes back on without being told the endpoint again", async () => {
      expect(await add(["--no-read-only"])).toBe(0)
      expect(written()).toMatchObject({ restEndpoint: "https://rest.fra-01.braze.eu", readOnly: false })
    })

    it("turns them off again", async () => {
      await add(["--no-read-only"])
      streams.stdout.length = 0

      expect(await add(["--read-only"])).toBe(0)
      expect(written()).toMatchObject({ readOnly: true })
    })

    it("does NOT silently unlock writes when only the endpoint is corrected", async () => {
      expect(await add(["--endpoint", "https://rest.fra-02.braze.eu"])).toBe(0)
      expect(written()).toMatchObject({ restEndpoint: "https://rest.fra-02.braze.eu", readOnly: true })
    })

    it("still demands an endpoint for a profile that does not exist yet", async () => {
      const code = await braze(["profile", "add", "brand-new"], { BRAZE_API_KEY: "k" })

      expect(code).toBe(2)
      expect(streams.stderr.join("\n")).toMatch(/needs --endpoint/)
    })
  })

  it("never writes the key into the config file", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "prod-key",
    })

    expect(readFileSync(join(configDir, "config.json"), "utf8")).not.toContain("prod-key")
  })

  // NEED-25: no profile is ever the default, so nothing is reached by omission.
  it("makes no profile the default, whichever was created first", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "k",
    })

    expect(JSON.parse(readFileSync(join(configDir, "config.json"), "utf8")).defaultProfile).toBeUndefined()
  })

  it("refuses a profile named after a command, which `braze <profile> …` would make ambiguous", async () => {
    const code = await braze(["profile", "add", "users", "--endpoint", "https://rest.fra-01.braze.eu"], {
      BRAZE_API_KEY: "k",
    })

    expect(code).toBe(2)
    expect(streams.stderr.join("\n")).toMatch(/would be ambiguous/)
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
      apiKey: { present: true, source: "keyring" },
    })
  })

  it("keeps the stored key when re-run only to correct the endpoint", async () => {
    await braze(["profile", "add", "production", "--endpoint", "https://rest.XXX.braze.YYY"], { BRAZE_API_KEY: "k" })
    streams.stdout.length = 0

    const code = await braze(["profile", "add", "production", "--endpoint", "https://rest.fra-01.braze.eu"])

    expect(code).toBe(0)
    expect(keyring.entries.get(`${keyringService(configDir, { BRAZE_CONFIG_DIR: configDir })}:production`)).toBe("k")
    expect(JSON.parse(streams.stdout.join("\n"))).toMatchObject({
      restEndpoint: "https://rest.fra-01.braze.eu",
      keyChanged: false,
    })
    expect(streams.stderr.join("\n")).toMatch(/keeping the key already in the keyring/)
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
