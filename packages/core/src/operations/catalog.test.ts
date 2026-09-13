import { describe, expect, it } from "vitest"
import { mayRetry } from "../operation.js"
import { catalog, findByCommand, findOperation } from "./index.js"

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

  // Today's behaviour, not the desired one. Braze implements this read as a POST, so classifying
  // by method calls it a write and the CLI refuses it on a read-only profile. CAT-4's first
  // override flips it, and this test is what will show that happening.
  it("still mis-classifies /users/export/ids as a write, which is FIND-13", () => {
    expect(findOperation("users.export.ids.create")?.access).toBe("write")
  })
})
