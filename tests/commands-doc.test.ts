import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * `CAT-8`. `docs/commands.md` is rendered from the live Commander tree, so the one thing that can
 * go wrong is it going stale — someone adds a command and the document quietly describes the CLI
 * of a week ago. These prove the gate actually catches that, the way `CAT-5`'s was proved by
 * removing an override and watching the build fail.
 */
const run = (args: string[]) => {
  try {
    return { ok: true, output: execFileSync("node", args, { encoding: "utf8", stdio: "pipe" }) }
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string }
    return { ok: false, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` }
  }
}

describe("the generated command documentation", () => {
  it("is in sync with the CLI as committed", () => {
    const result = run(["scripts/generate-commands-doc.mjs", "--check"])

    expect(result.output).toContain("up to date")
    expect(result.ok).toBe(true)
  })

  it("documents every runnable command, handwritten and generated alike", () => {
    const doc = readFileSync("docs/commands.md", "utf8")

    // The point of rendering from the program rather than the snapshot: the snapshot knows
    // nothing about `profile add`, and would have documented only the generated ones.
    expect(doc).toContain("### `braze profile add`")
    expect(doc).toContain("### `braze schema`")
    expect(doc).toContain("### `braze <profile> campaigns list`")

    // Counted rather than pinned to a number: a new command must not fail this test, only an
    // unbalanced total should.
    const counted = doc.match(/(\d+) runnable commands: (\d+) written by hand, (\d+) generated/)
    expect(counted).not.toBeNull()
    const [, total, handwritten, generated] = (counted ?? []).map(Number)
    expect(handwritten).toBeGreaterThan(1)
    expect(total).toBe(handwritten + generated)
  })

  /**
   * `NEED-25`: a command that reaches Braze names its profile first and there is no default. A
   * document that printed `braze campaigns list` would be telling the reader to run something
   * that fails with `configuration_error`.
   */
  it("puts the profile in the usage of a command that talks to Braze, and not in one that does not", () => {
    const doc = readFileSync("docs/commands.md", "utf8")

    expect(doc).toContain("### `braze <profile> users track`")
    expect(doc).toContain("### `braze commands`")
    expect(doc).not.toContain("### `braze <profile> commands`")
  })

  it("carries the operation id, so a reader can go straight to braze schema", () => {
    expect(readFileSync("docs/commands.md", "utf8")).toContain("Operation `campaigns.list.get`.")
  })

  it("names the line that went stale rather than only saying the file differs", () => {
    const result = run(["scripts/generate-commands-doc.mjs", "--check", "--out", "tests/fixtures/missing-doc.md"])

    expect(result.ok).toBe(false)
    expect(result.output).toContain("pnpm docs:generate")
  })
})
