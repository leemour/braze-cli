import { describe, expect, it } from "vitest"
import { BrazeError } from "./errors.js"
import { defineOperation, rawOperation } from "./operation.js"
import { catalog, findOperation } from "./operations/index.js"
import { schemas } from "./operations/schemas.js"
import { validateRequest } from "./validate.js"

const code = (run: () => void): string | undefined => {
  try {
    run()
    return undefined
  } catch (error) {
    return error instanceof BrazeError ? error.code : "not-a-braze-error"
  }
}

const message = (run: () => void): string => {
  try {
    run()
    return ""
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe("what `generated` may say about a body", () => {
  const withExample = defineOperation({
    id: "thing.create",
    command: ["thing"],
    method: "POST",
    path: "/thing",
    access: "write",
    requestBody: { source: "example", example: { attributes: [] } },
  })

  it("refuses an array where Braze documents an object, which could never have worked", () => {
    expect(code(() => validateRequest(withExample, { body: [1, 2] }))).toBe("validation_error")
    expect(message(() => validateRequest(withExample, { body: [1, 2] }))).toContain("expects a JSON object")
  })

  /**
   * The whole point of the level. One example is not a schema: `/users/track`'s shows three
   * fields, and a request carrying a fourth that Braze added last week is valid. A level that
   * refused it would be the wrong-schema failure this design exists to avoid.
   */
  it("accepts a key the example never mentioned", () => {
    expect(code(() => validateRequest(withExample, { body: { something_new: true } }))).toBeUndefined()
  })

  it("accepts a subset of the example's keys", () => {
    expect(code(() => validateRequest(withExample, { body: {} }))).toBeUndefined()
  })

  it("says nothing at all when Braze's own documentation was prose rather than JSON", () => {
    const annotated = defineOperation({
      id: "prose.create",
      command: ["prose"],
      method: "POST",
      path: "/prose",
      access: "write",
      validation: "passthrough",
      requestBody: { source: "annotated", text: '{ "x": (required, string) ... }' },
    })

    expect(code(() => validateRequest(annotated, { body: "anything at all" }))).toBeUndefined()
  })

  /**
   * Braze documents no body for these, so sending one is a mistake nameable without a schema.
   *
   * Not reachable through the CLI: a generated GET command offers no `--input`, and `braze api` is
   * deliberately `passthrough` so the escape hatch stays absolute. It serves the other audience —
   * `brazecli-core` is a package a Worker imports directly, and there nothing else would catch it.
   */
  it("refuses a body on a GET, which Braze has nowhere to put", () => {
    const read = findOperation("campaigns.list.get")

    expect(read && code(() => validateRequest(read, { body: { a: 1 } }))).toBe("validation_error")
    expect(read && code(() => validateRequest(read, {}))).toBeUndefined()
  })
})

describe("what `strict` may say", () => {
  const track = findOperation("users.track.create")

  it("accepts the shape Braze documents", () => {
    expect(
      track && code(() => validateRequest(track, { body: { attributes: [{ external_id: "u1" }] } })),
    ).toBeUndefined()
  })

  it("refuses a request carrying none of the three arrays", () => {
    expect(track && message(() => validateRequest(track, { body: {} }))).toContain("at least one of attributes")
  })

  /**
   * BUG-8. Braze's limit is 75 objects counted across the three arrays together; the per-array 75
   * is their own legacy limit. A pipeline batching by the old reading would send 225 and have
   * every request refused.
   */
  it("counts the 75-object limit across the arrays together, not per array", () => {
    const forty = (id: string) => Array.from({ length: 40 }, () => ({ external_id: id }))

    // 40 + 40 = 80: under 75 in each array, over it combined.
    expect(track && code(() => validateRequest(track, { body: { attributes: forty("a"), events: forty("b") } }))).toBe(
      "validation_error",
    )
    expect(
      track && message(() => validateRequest(track, { body: { attributes: forty("a"), events: forty("b") } })),
    ).toContain("counted across")
  })

  it("refuses two identifier kinds in one delete, which Braze rejects outright", () => {
    const remove = findOperation("users.delete.create")
    const body = { external_ids: ["a"], braze_ids: ["b"] }

    expect(remove && message(() => validateRequest(remove, { body }))).toContain("exactly one of")
    expect(remove && code(() => validateRequest(remove, { body: { external_ids: ["a"] } }))).toBeUndefined()
  })

  it("names the operation it refused, so the message is actionable on its own", () => {
    expect(track && message(() => validateRequest(track, { body: {} }))).toContain("users.track.create")
  })
})

describe("the levels across the whole catalog", () => {
  it("gives every operation a level", () => {
    expect(catalog.filter((operation) => !operation.validation)).toEqual([])
  })

  it("marks nothing strict without a handwritten schema behind it", () => {
    const strict = catalog.filter((operation) => operation.validation === "strict")

    expect(strict.length).toBeGreaterThan(0)
    for (const operation of strict) expect(schemas[operation.id], operation.id).toBeDefined()
  })

  it("has a schema for nothing that is not marked strict, so no schema sits unused", () => {
    for (const id of Object.keys(schemas)) {
      expect(findOperation(id)?.validation, id).toBe("strict")
    }
  })

  /**
   * §11 of the brief ends with "`braze api` remains the final escape hatch". A handwritten schema
   * that wrongly refuses a valid request has to leave the caller somewhere to go.
   */
  it("leaves a raw operation unvalidated, whatever the catalog says about the same path", () => {
    const raw = rawOperation("POST", "/users/track")

    expect(raw.validation).toBe("passthrough")
    expect(code(() => validateRequest(raw, { body: {} }))).toBeUndefined()
  })

  it("still refuses what path and query validation already refused", () => {
    const item = findOperation("catalogs.by-id.items.by-id.get")

    expect(item && code(() => validateRequest(item, {}))).toBe("validation_error")
  })
})
