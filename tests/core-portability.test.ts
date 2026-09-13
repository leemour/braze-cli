import { execFileSync } from "node:child_process"
import { describe, expect, it } from "vitest"

// The gate itself is tested, not just configured. If someone relaxes it, this goes red.
describe("core portability gate", () => {
  it("bundles packages/core for a runtime with no Node builtins", () => {
    const output = execFileSync("node", ["scripts/check-core-portability.mjs"], { encoding: "utf8" })

    expect(output).toContain("no Node globals")
  })
})
