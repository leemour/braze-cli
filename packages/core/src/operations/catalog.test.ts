import { describe, expect, it } from "vitest"
import { defineOperation, mayRetry } from "../operation.js"
import { buildUrl } from "../request.js"
import { applyOverrides, catalog, describeParameters, findByCommand, findOperation } from "./index.js"
import { parameterDescriptions } from "./parameters.js"

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

/**
 * CAT-9. Every property here holds for all 95 operations or for none — a sample would pass while
 * the generator quietly mangled the one endpoint nobody thought to name. Each assertion carries
 * the operation id, so a failure says which one.
 */
describe("the contract every generated operation keeps", () => {
  const ID = /^[a-z0-9][a-z0-9.-]*$/
  const WORD = /^[a-z0-9][a-z0-9-]*$/
  const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
  const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

  it.each(catalog.map((operation) => [operation.id, operation] as const))(
    "%s is callable, addressable and safe to classify",
    (id, operation) => {
      expect(ID.test(id), `id ${id}`).toBe(true)
      expect(METHODS.has(operation.method), `${id} method ${operation.method}`).toBe(true)

      expect(operation.path.startsWith("/"), `${id} path`).toBe(true)
      expect(operation.path, `${id} path`).not.toMatch(/\{\{|\s/)

      expect(["read", "write"], `${id} access`).toContain(operation.access)
      if (operation.access === "write") expect(operation.retryPolicy, `${id} retry`).not.toBe("read-safe")

      expect(operation.command.length, `${id} command`).toBeGreaterThan(0)
      for (const word of operation.command) expect(WORD.test(word), `${id} word "${word}"`).toBe(true)
    },
  )

  // The only thing an agent is told in order to call the operation at all. Matching the path is
  // not enough — the order has to match too, since that is what `braze commands --json` prints.
  it("names every path placeholder, in the order the path uses them", () => {
    for (const operation of catalog) {
      const placeholders = [...operation.path.matchAll(PLACEHOLDER)].map(([, name]) => name)
      expect(operation.pathParameters ?? [], operation.id).toEqual(placeholders)
    }
  })

  it("builds a real request for every operation, with no placeholder left behind", () => {
    const endpoint = new URL("https://rest.iad-01.braze.com")

    for (const operation of catalog) {
      const pathParams = Object.fromEntries((operation.pathParameters ?? []).map((name) => [name, "x"]))
      const url = buildUrl(endpoint, { method: operation.method, path: operation.path, pathParams })

      expect(url.pathname, operation.id).not.toContain("{")
      expect(url.protocol, operation.id).toBe("https:")
    }
  })

  it("gives an operation no two query parameters under one name", () => {
    for (const operation of catalog) {
      const names = (operation.queryParameters ?? []).map((parameter) => parameter.name)
      expect(new Set(names).size, operation.id).toBe(names.length)
    }
  })

  /**
   * BUG-6: Braze describes `PATCH /catalogs/{catalog_name}/items` — editing items — with the
   * sentence it uses for deleting them. The description reaches `--help`, `braze commands --json`
   * and the generated docs, so an agent choosing a command by description reads "delete" for the
   * edit endpoint. A wrong description is worse than a missing one.
   *
   * Two operations sharing a description under DIFFERENT methods is the signature of that
   * copy-paste. The two legitimate cases share a method — `/email/blocklist` with its
   * `blacklist` spelling, and the v1/v2 subscription pair — so this catches Braze's mistake
   * without catching Braze's aliases.
   */
  it("lets no two operations with different methods share a description", () => {
    const byDescription = new Map<string, Set<string>>()

    for (const operation of catalog) {
      if (!operation.description) continue
      const methods = byDescription.get(operation.description) ?? new Set()
      methods.add(operation.method)
      byDescription.set(operation.description, methods)
    }

    const shared = [...byDescription].filter(([, methods]) => methods.size > 1)
    expect(shared.map(([description]) => description)).toEqual([])
  })
})

/**
 * CAT-13. `braze campaigns list --help` used to print `--page <value>  query parameter (e.g. 0)`
 * for all 134 parameter slots in the catalog — a line shaped like documentation that carries
 * nothing (`UX-5`). The collection cannot help: it holds no structured query entries at all.
 */
describe("what each query parameter means", () => {
  it("leaves no flag in the whole catalog undescribed", () => {
    const undescribed = catalog.flatMap((operation) =>
      (operation.queryParameters ?? [])
        .filter((parameter) => !parameter.description)
        .map((parameter) => `${operation.id} --${parameter.name}`),
    )

    // The gate, not the report: a parameter Braze adds later arrives here with no description,
    // and this fails naming it rather than letting it ship as "query parameter".
    expect(undescribed).toEqual([])
  })

  it("says something different for each flag, rather than one placeholder repeated", () => {
    const descriptions = catalog.flatMap((operation) =>
      (operation.queryParameters ?? []).map((parameter) => parameter.description),
    )

    expect(descriptions).not.toContain("query parameter")
    expect(new Set(descriptions).size).toBeGreaterThan(40)
  })

  it("describes `page` identically wherever it appears, which is why this is keyed by name", () => {
    const pages = catalog
      .flatMap((operation) => operation.queryParameters ?? [])
      .filter((parameter) => parameter.name === "page")

    expect(pages.length).toBe(6)
    expect(new Set(pages.map((parameter) => parameter.description)).size).toBe(1)
  })

  /**
   * The cap on `length` is 100 on campaign analytics and 14 on Canvas; `limit` is capped at 500
   * for email lists and 1000 for Content Blocks. One glossary line cannot name either as *the*
   * limit without being wrong on the other endpoint, so it names neither.
   */
  it("states no single cap for a parameter whose cap differs per endpoint", () => {
    expect(parameterDescriptions.length).toContain("differs by endpoint")
    expect(parameterDescriptions.limit).toContain("differs by endpoint")
  })

  it("lets a per-operation description win, since it is the more specific of the two", () => {
    const operations = [
      defineOperation({
        id: "a.get",
        command: ["a"],
        method: "GET",
        path: "/a",
        access: "read",
        queryParameters: [{ name: "page", description: "pages of something unusual" }, { name: "limit" }],
      }),
    ]

    const [described] = describeParameters(operations, { page: "generic", limit: "generic" })

    expect(described?.queryParameters?.[0]?.description).toBe("pages of something unusual")
    expect(described?.queryParameters?.[1]?.description).toBe("generic")
  })

  it("leaves a parameter nobody has described alone rather than inventing text", () => {
    const operations = [
      defineOperation({
        id: "a.get",
        command: ["a"],
        method: "GET",
        path: "/a",
        access: "read",
        queryParameters: [{ name: "mystery" }],
      }),
    ]

    expect(describeParameters(operations, {})[0]?.queryParameters?.[0]?.description).toBeUndefined()
  })
})
