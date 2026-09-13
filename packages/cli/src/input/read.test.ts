import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readInput } from "./read.js"

describe("reading input", () => {
  it("reads @file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "brazecli-input-")), "users.json")
    writeFileSync(path, '{"attributes":[{"external_id":"u1"}]}')

    expect(readInput(`@${path}`)).toEqual({ attributes: [{ external_id: "u1" }] })
  })

  it("reads standard input for -", () => {
    expect(readInput("-", { readStdin: () => '{"a":1}' })).toEqual({ a: 1 })
  })

  it("takes JSON given inline", () => {
    expect(readInput('{"a":1}')).toEqual({ a: 1 })
  })

  it("names the file it could not open", () => {
    expect(() => readInput("@/nowhere/users.json")).toThrow(/cannot read \/nowhere\/users.json/)
  })

  it("refuses malformed JSON before anything can be sent", () => {
    expect(() => readInput("{ not json")).toThrow(/not valid JSON/)
  })

  it("refuses an empty input rather than sending nothing somewhere", () => {
    expect(() => readInput("-", { readStdin: () => "  " })).toThrow(/standard input is empty/)
  })
})
