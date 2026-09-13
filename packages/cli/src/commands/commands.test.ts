import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { captureStreams } from "../output/stream.js"
import { run } from "../program.js"

let configDir: string
let streams: ReturnType<typeof captureStreams>

const discover = async (argv: string[] = ["commands", "--json"]) => {
  const code = await run(argv, { env: { BRAZE_CONFIG_DIR: configDir }, streams, isTty: false })
  return { code, surface: JSON.parse(streams.stdout.join("\n")) }
}

interface DiscoveredCommand {
  name: string
  path: string[]
  usage: string
  commands: DiscoveredCommand[]
}

const find = (commands: DiscoveredCommand[], name: string): DiscoveredCommand => {
  const hit = commands.find((command) => command.name === name)
  if (!hit) throw new Error(`no command named ${name}`)
  return hit
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "brazecli-commands-"))
  streams = captureStreams()
})

describe("braze commands", () => {
  it("puts one JSON value on stdout and nothing else", async () => {
    const { code } = await discover()

    expect(code).toBe(0)
    expect(streams.stderr).toEqual([])
  })

  it("lists every registered command, nested, with the argv path already split", async () => {
    const { surface } = await discover()

    expect(surface.commands.map((command: DiscoveredCommand) => command.name)).toEqual([
      "profile",
      "api",
      "runs",
      "commands",
    ])

    const list = find(find(surface.commands, "runs").commands, "list")
    expect(list.path).toEqual(["runs", "list"])
    expect(list.usage).toBe("braze runs list [options]")
  })

  it("says which options take a value, and separately which must be given", async () => {
    const { surface } = await discover()
    const option = (flags: string) =>
      surface.globalOptions.find((candidate: { flags: string }) => candidate.flags === flags)

    // Commander calls both of these `required`, meaning different things. An agent reading
    // --profile as mandatory would refuse to run without one.
    expect(option("--json")).toMatchObject({ takesValue: false, mandatory: false })
    expect(option("--profile <name>")).toMatchObject({ takesValue: true, mandatory: false })
  })

  it("carries the choices for a constrained option", async () => {
    const { surface } = await discover()
    const output = surface.globalOptions.find((option: { flags: string }) => option.flags === "--output <format>")

    expect(output.choices).toEqual(["auto", "pretty", "json", "jsonl"])
  })

  it("publishes the exit code for every failure a script branches on", async () => {
    const { surface } = await discover()

    expect(surface.exitCodes).toMatchObject({ ok: 0, permission_error: 5, not_found: 6, cancelled: 130 })
  })

  it("needs no profile and survives a configuration it cannot read", async () => {
    const { code, surface } = await discover()

    expect(code).toBe(0)
    expect(surface.commands.length).toBeGreaterThan(0)
  })

  it("renders a flat table for a terminal instead of the whole tree", async () => {
    const code = await run(["commands", "--output", "pretty"], {
      env: { BRAZE_CONFIG_DIR: configDir },
      streams,
      isTty: true,
    })

    expect(code).toBe(0)
    expect(streams.stdout.join("\n")).toContain("braze api <method> <path> [options]")
    expect(streams.stdout.join("\n")).not.toContain("takesValue")
  })
})
