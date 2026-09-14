import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const generate = (spec: string, extra: string[] = []) => {
  const out = join(mkdtempSync(join(tmpdir(), "brazecli-catalog-")), "generated.ts")
  const coverage = out.replace("generated.ts", "coverage.md")
  const args = ["scripts/generate-catalog.mjs", "--spec", spec, "--out", out, "--coverage", coverage, ...extra]
  try {
    return { ok: true, output: execFileSync("node", args, { encoding: "utf8", stdio: "pipe" }), out }
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string }
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`, out }
  }
}

describe("the generator refusing to lose an operation", () => {
  it("fails when two different endpoints derive one id, instead of overwriting", () => {
    const result = generate("tests/fixtures/catalog/colliding.json")

    expect(result.ok).toBe(false)
    expect(result.output).toContain("derive the id")
    expect(result.output).toContain("never let an operation vanish")
  })

  it("fails on a request with no path", () => {
    const result = generate("tests/fixtures/catalog/no-path.json")

    expect(result.ok).toBe(false)
    expect(result.output).toContain("no path")
  })

  it("adds a verb only where the bare path would be ambiguous", () => {
    const result = generate("tests/fixtures/catalog/small.json")
    const written = readFileSync(result.out, "utf8")

    expect(result.ok).toBe(true)
    // /campaigns/list is alone on its path, so it keeps the bare name.
    expect(written).toContain('command: ["campaigns", "list"]')
    // /catalogs carries both a GET and a POST, so each needs the verb to stay distinct.
    expect(written).toContain('command: ["catalogs", "get"]')
    expect(written).toContain('command: ["catalogs", "create"]')
    // Two GETs differing only by a trailing parameter escalate to the marked form.
    expect(written).toContain('command: ["catalogs", "by-id", "items", "by-id", "get"]')
  })
})

describe("catalog:check", () => {
  it("passes against the committed catalog", () => {
    const result = execFileSync("node", ["scripts/generate-catalog.mjs", "--check"], { encoding: "utf8" })

    expect(result).toContain("up to date")
  })

  it("fails when the catalog does not match the spec it claims to come from", () => {
    const result = generate("tests/fixtures/catalog/small.json", ["--check"])

    expect(result.ok).toBe(false)
    expect(result.output).toContain("out of date")
  })
})

// §12: a number nobody blocks on is a number nobody reads.
describe("the coverage gate", () => {
  it("refuses a write whose path reads like a query and that no override has ruled on", () => {
    const result = generate("tests/fixtures/catalog/unclassified.json")

    expect(result.ok).toBe(false)
    expect(result.output).toContain("no override says either way")
    expect(result.output).toContain("POST /widgets/export")
  })

  it("stays quiet about a write that plainly is one", () => {
    const result = generate("tests/fixtures/catalog/small.json")

    expect(result.ok).toBe(true)
    expect(result.output).toContain("unclassified:        0")
  })

  it("writes a coverage report next to the catalog", () => {
    const result = generate("tests/fixtures/catalog/small.json")
    const report = readFileSync(result.out.replace("generated.ts", "coverage.md"), "utf8")

    expect(report).toContain("| Braze requests | 5 |")
    expect(report).toContain("| unclassified or ambiguous | 0 |")
  })
})
