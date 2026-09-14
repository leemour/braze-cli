import { describe, expect, it } from "vitest"
import { defineOperation, mayRetry } from "../operation.js"
import { applyOverrides, catalog, findByCommand, findOperation } from "./index.js"

describe("the generated catalog", () => {
  it("covers the whole snapshot, with nothing dropped in silence", () => {
    // 99 Braze requests, 4 of them the same endpoint documented twice (FIND-15).
    expect(catalog.length).toBe(95)
  })

  it("gives every operation a unique id and a unique command", () => {
    expect(new Set(catalog.map((operation) => operation.id)).size).toBe(catalog.length)
    expect(new Set(catalog.map((operation) => operation.command.join(" "))).size).toBe(catalog.length)
  })

  it("fills the fields a caller cannot work without", () => {
    for (const operation of catalog) {
      expect(operation.path.startsWith("/"), operation.id).toBe(true)
      expect(operation.command.length, operation.id).toBeGreaterThan(0)
      expect(operation.sourceId, operation.id).toBeTruthy()
    }
  })

  it("keeps the ids documented in operation.ts readable for a plain path", () => {
    expect(findOperation("campaigns.list.get")?.path).toBe("/campaigns/list")
    expect(findOperation("users.track.create")?.path).toBe("/users/track")
  })

  it("names each path placeholder, since that is all an agent has to go on", () => {
    const item = findOperation("catalogs.by-id.items.by-id.get")

    expect(item?.path).toBe("/catalogs/{catalog_name}/items/{item_id}")
    expect(item?.pathParameters).toEqual(["catalog_name", "item_id"])
  })

  // BUG-4: the first generator read only Postman's structured url.query, which this collection
  // never uses, and extracted nothing at all. A fixture written to match the code said it worked;
  // only the real catalog catches that, so this asserts against the real catalog.
  it("extracts the query parameters Braze puts in the raw URL", () => {
    const campaigns = findOperation("campaigns.list.get")
    const names = campaigns?.queryParameters?.map((parameter) => parameter.name)

    expect(names).toContain("page")
    expect(names).toContain("include_archived")
    expect(catalog.filter((operation) => (operation.queryParameters?.length ?? 0) > 0).length).toBeGreaterThan(30)
  })

  it("drops a Postman placeholder rather than offering it as an example value", () => {
    const examples = catalog.flatMap((operation) =>
      (operation.queryParameters ?? []).map((parameter) => parameter.example ?? ""),
    )

    expect(examples.some((example) => example.includes("{{"))).toBe(false)
  })

  it("merges the four endpoints Braze documents twice, rather than emitting either twice", () => {
    for (const path of ["/subscription/status/get", "/subscription/user/status", "/v2/subscription/status/set"]) {
      expect(catalog.filter((operation) => operation.path === path).length, path).toBe(1)
    }
  })

  it("finds an operation by command as whole words", () => {
    expect(findByCommand(["campaigns", "list"])?.id).toBe("campaigns.list.get")
    expect(findByCommand(["campaigns"])).toBeUndefined()
  })

  it("defaults retries the safe way round: reads repeat, writes never do", () => {
    const read = findOperation("campaigns.list.get")
    const write = findOperation("users.track.create")

    expect(read && mayRetry(read)).toBe(true)
    expect(write && mayRetry(write)).toBe(false)
  })

  // FIND-13, the case overrides exist for. Braze implements this read as a POST, so classifying by
  // HTTP method called it a write and a read-only profile refused it. The override corrects both
  // the classification and, with it, whether a repeat is safe.
  it("classifies /users/export/ids as the read it is, despite the POST", () => {
    const operation = findOperation("users.export.ids.create")

    expect(operation?.method).toBe("POST")
    expect(operation?.access).toBe("read")
    expect(operation?.retryPolicy).toBe("read-safe")
  })

  it("carries the facts Postman does not: permission, batch limits, pagination", () => {
    expect(findOperation("users.track.create")?.batch).toEqual({ attributes: 75, events: 75, purchases: 75 })
    expect(findOperation("users.track.create")?.permission).toBe("users.track")
    expect(findOperation("campaigns.list.get")?.pagination).toBe("page")
  })
})

describe("applying overrides", () => {
  const generated = [
    defineOperation({ id: "a.create", command: ["a"], method: "POST", path: "/a", access: "write" }),
    defineOperation({ id: "b.get", command: ["b"], method: "GET", path: "/b", access: "read" }),
  ]

  it("leaves an operation nobody corrected exactly as generated", () => {
    const [, b] = applyOverrides(generated, { "a.create": { access: "read", reason: "x" } })

    expect(b).toBe(generated[1])
  })

  it("re-derives whether a repeat is safe when a correction flips access", () => {
    const [a] = applyOverrides(generated, { "a.create": { access: "read", reason: "a POST-shaped read" } })

    // The generated operation was `never`, being a POST. Leaving it there would keep the wrong
    // answer to "may this be repeated" for an operation that is now known to be a read.
    expect(a?.access).toBe("read")
    expect(a?.retryPolicy).toBe("read-safe")
  })

  it("refuses an override that matches no operation, rather than ignoring it", () => {
    expect(() => applyOverrides(generated, { "gone.get": { access: "read", reason: "stale" } })).toThrow(/stale/)
  })

  it("refuses to make a write repeatable, which operation.ts asks this to reject", () => {
    expect(() => applyOverrides(generated, { "a.create": { retryPolicy: "read-safe", reason: "wrong" } })).toThrow(
      /could duplicate the effect/,
    )
  })

  it("refuses an override that empties the command", () => {
    expect(() => applyOverrides(generated, { "b.get": { command: [], reason: "wrong" } })).toThrow(/no command/)
  })
})
