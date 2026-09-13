import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

const run = (entry?: string) => {
  const args = ["scripts/check-core-portability.mjs", ...(entry ? [entry] : [])]
  try {
    return { ok: true, output: execFileSync("node", args, { encoding: "utf8", stdio: "pipe" }) }
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string }
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
  }
}

// The gate is tested in both directions. A gate that never fires is decoration; a gate that
// fires on prose gets deleted the first time it blocks a real commit.
describe("core portability gate", () => {
  it("passes packages/core", () => {
    const result = run()

    expect(result.output).toContain("no Node globals")
    expect(result.ok).toBe(true)
  })

  it("rejects a Node global", () => {
    const result = run("tests/fixtures/portability/node-global.ts")

    expect(result.output).toContain("Node-only globals: process")
    expect(result.ok).toBe(false)
  })

  it("rejects a node: import, which no lint rule sees inside a dependency", () => {
    const result = run("tests/fixtures/portability/node-import.ts")

    expect(result.output).toContain('Could not resolve "node:crypto"')
    expect(result.ok).toBe(false)
  })

  it("stays quiet on prose that merely contains the word process", () => {
    const result = run("tests/fixtures/portability/clean.ts")

    expect(result.output).toContain("no Node globals")
    expect(result.ok).toBe(true)
  })
})
