import { describe, expect, it } from "vitest"
import { identifiersOf } from "./identity.js"

describe("what the audit is allowed to keep", () => {
  it("copies the identifiers and leaves everything else behind", () => {
    const identity = identifiersOf({
      external_id: "u1",
      email: "a@example.com",
      salary: 90_000,
      medical_notes: "private",
    })

    expect(identity).toEqual({ external_id: "u1", email: "a@example.com" })
  })

  /** An alias object is customer data like any other — copying it whole is the way §35 gets broken. */
  it("rebuilds the alias from its two documented keys", () => {
    const identity = identifiersOf({ user_alias: { alias_name: "n", alias_label: "l", diagnosis: "private" } })

    expect(identity).toEqual({ user_alias: { alias_name: "n", alias_label: "l" } })
  })

  it("gives nothing for a record that names no user", () => {
    expect(identifiersOf({ colour: "amber" })).toBeUndefined()
    expect(identifiersOf("not an object")).toBeUndefined()
    expect(identifiersOf(null)).toBeUndefined()
  })

  it("ignores an identifier that is present but empty", () => {
    expect(identifiersOf({ external_id: "" })).toBeUndefined()
  })
})
