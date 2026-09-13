import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it } from "vitest"

const FIXTURES = "tests/fixtures/spec"

let out: string

/**
 * Always with `--from`, never the network. A test that reaches Braze's documenter would fail on
 * a plane and would also be testing Postman's uptime rather than this script.
 */
const sync = (fixture: string, extra: string[] = []) => {
  const args = ["scripts/sync-spec.mjs", "--from", join(FIXTURES, fixture), "--out", out, ...extra]
  try {
    return { ok: true, output: execFileSync("node", args, { encoding: "utf8", stdio: "pipe" }) }
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string }
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
  }
}

const provenance = () => JSON.parse(readFileSync(join(out, "provenance.json"), "utf8"))

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "brazecli-spec-"))
})

describe("spec:sync writing a snapshot", () => {
  it("writes the collection and its provenance", () => {
    const result = sync("valid.json")

    expect(result.ok).toBe(true)
    expect(result.output).toContain("3 requests in 1 folders")
    expect(existsSync(join(out, "braze.postman.json"))).toBe(true)
    expect(provenance()).toMatchObject({
      sourceCollectionId: "29829c45-e619-4c12-910f-564ec8ccfda9",
      collectionName: "Braze Endpoints",
      requests: 3,
      folders: 1,
    })
  })

  it("formats the snapshot rather than storing it as one line, so a diff is readable", () => {
    sync("valid.json")

    const written = readFileSync(join(out, "braze.postman.json"), "utf8")
    expect(written.split("\n").length).toBeGreaterThan(10)
    expect(written.endsWith("\n")).toBe(true)
  })

  it("records both hashes, of the source bytes and of the file it wrote", () => {
    sync("valid.json")
    const { sha256, sourceSha256 } = provenance()

    expect(sourceSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(sha256).toMatch(/^[0-9a-f]{64}$/)
    // Different on purpose: one identifies what Braze served, the other the formatted artifact.
    expect(sha256).not.toBe(sourceSha256)
  })

  it("does nothing the second time, so an unchanged sync leaves no diff", () => {
    sync("valid.json")
    const first = provenance().syncedAt

    const again = sync("valid.json")

    expect(again.output).toContain("unchanged")
    expect(provenance().syncedAt).toBe(first)
  })
})

// The failure that would actually hurt is committing an HTML error page as the catalog, so each
// of these asserts BOTH that it refused and that it wrote nothing (RISK-2).
describe("spec:sync refusing what is not a collection", () => {
  const cases = [
    ["markup.html", "markup, not JSON"],
    ["broken.json", "not valid JSON"],
    ["no-schema.json", "not a collection"],
    ["empty-items.json", "empty collection"],
    ["folders-only.json", "no requests"],
  ] as const

  for (const [fixture, expected] of cases) {
    it(`refuses ${fixture} and writes nothing`, () => {
      const result = sync(fixture)

      expect(result.ok).toBe(false)
      expect(result.output).toContain(expected)
      expect(existsSync(join(out, "braze.postman.json"))).toBe(false)
    })
  }
})

describe("spec:sync --check", () => {
  it("fails when no snapshot exists yet", () => {
    const result = sync("valid.json", ["--check"])

    expect(result.ok).toBe(false)
    expect(result.output).toContain("no snapshot yet")
  })

  it("fails when upstream has moved on, naming both hashes", () => {
    sync("valid.json")

    const result = sync("changed.json", ["--check"])

    expect(result.ok).toBe(false)
    expect(result.output).toContain("stale")
  })

  it("passes when the snapshot matches, and writes nothing either way", () => {
    sync("valid.json")
    const before = readFileSync(join(out, "provenance.json"), "utf8")

    const result = sync("valid.json", ["--check"])

    expect(result.ok).toBe(true)
    expect(readFileSync(join(out, "provenance.json"), "utf8")).toBe(before)
  })
})
