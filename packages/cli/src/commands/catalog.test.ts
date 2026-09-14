import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { catalog } from "brazecli-core"
import { brazeResponses, mockBraze } from "brazecli-core/testing"
import { beforeEach, describe, expect, it } from "vitest"
import { memoryKeyring } from "../auth/keyring.js"
import { emptyConfig, saveConfig } from "../config/file.js"
import { captureStreams } from "../output/stream.js"
import { run } from "../program.js"

let configDir: string
let runsDir: string
let streams: ReturnType<typeof captureStreams>

const braze = (argv: string[], mock: ReturnType<typeof mockBraze>, readOnly = false) => {
  const config = emptyConfig()
  config.profiles.production = { restEndpoint: "https://rest.iad-01.braze.com", readOnly }
  config.defaultProfile = "production"
  saveConfig(configDir, config)

  return run(argv, {
    env: { BRAZE_CONFIG_DIR: configDir, BRAZE_RUNS_DIR: runsDir, BRAZE_API_KEY: "test-key" },
    keyring: memoryKeyring(),
    streams,
    isTty: false,
    fetch: mock.fetch,
  })
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-cat-"))
  runsDir = mkdtempSync(join(tmpdir(), "brazecli-catruns-"))
  streams = captureStreams()
})

describe("commands generated from the catalog", () => {
  it("sends the request the catalog describes — the phase's done criterion", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [{ id: "c1" }] }))

    const code = await braze(["campaigns", "list", "--json"], mock)

    expect(code).toBe(0)
    expect(mock.requests[0]?.url).toContain("/campaigns/list")
    expect(JSON.parse(streams.stdout.join("\n"))).toEqual({ campaigns: [{ id: "c1" }] })
  })

  it("turns a path placeholder into a required named option and substitutes it", async () => {
    const mock = mockBraze(brazeResponses.ok({ items: [] }))

    const code = await braze(["catalogs", "items", "list", "--catalog-name", "my-catalog", "--json"], mock)

    expect(code).toBe(0)
    expect(mock.requests[0]?.url).toContain("/catalogs/my-catalog/items")
  })

  it("refuses to run when a required path placeholder is missing", async () => {
    const mock = mockBraze(brazeResponses.ok({}))

    expect(await braze(["catalogs", "items", "list", "--json"], mock)).not.toBe(0)
    expect(mock.requests).toHaveLength(0)
  })

  it("passes a documented query parameter under the name Braze uses, brackets and all", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [] }))

    await braze(["campaigns", "list", "--last-edit-time-gt", "2020-06-28", "--page", "2", "--json"], mock)

    expect(mock.requests[0]?.url).toContain("last_edit.time%5Bgt%5D=2020-06-28")
    expect(mock.requests[0]?.url).toContain("page=2")
  })

  it("still takes --query, because Postman's examples are not the whole list of parameters", async () => {
    const mock = mockBraze(brazeResponses.ok({ campaigns: [] }))

    await braze(["campaigns", "list", "--query", "undocumented=1", "--json"], mock)

    expect(mock.requests[0]?.url).toContain("undocumented=1")
  })

  it("obeys the read-only profile exactly as `braze api` does", async () => {
    const mock = mockBraze(brazeResponses.created())

    const code = await braze(["users", "track", "--input", "{}", "--confirm", "--json"], mock, true)

    expect(code).toBe(5)
    expect(mock.requests).toHaveLength(0)
  })

  it("lets a POST-shaped read through on a read-only profile, because an override says it is a read", async () => {
    const mock = mockBraze(brazeResponses.created())

    const code = await braze(["users", "export", "ids", "--input", '{"external_ids":[]}', "--json"], mock, true)

    expect(code).toBe(0)
    expect(mock.requests).toHaveLength(1)
  })
})

describe("the shape of the generated command tree", () => {
  it("gives no command a name that is also a group, which Commander refuses outright", () => {
    const names = catalog.map((operation) => operation.command.join(" "))

    for (const name of names) {
      expect(
        names.filter((other) => other.startsWith(`${name} `)),
        name,
      ).toHaveLength(0)
    }
  })

  it("keeps the id's disambiguation marker out of the words a person types", () => {
    expect(catalog.filter((operation) => operation.command.includes("by-id"))).toHaveLength(0)
  })
})
