// Dev-time only. Turns the committed snapshot into a TypeScript catalog, so nobody hand-writes
// a hundred nearly identical operations (REQUIREMENTS §9, §13).
//
//   node scripts/generate-catalog.mjs              # write the catalog
//   node scripts/generate-catalog.mjs --check      # fail if it is out of date; writes nothing
//   node scripts/generate-catalog.mjs --spec x.json --out y.ts
//
// The generator is plain JS on purpose: what needs type checking is its OUTPUT, and `tsc` does
// that when it builds core. A typed generator producing an untyped file would be backwards.
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

const DEFAULT_SPEC = "spec/braze.postman.json"
const DEFAULT_OUT = "packages/core/src/operations/generated.ts"

// Braze's own paths carry the action, so `/campaigns/list` needs no verb from us. Only the
// REST-shaped resources (catalogs, scim, preference_center) do, and there the method is the verb.
const VERBS = { GET: "get", POST: "create", PUT: "replace", PATCH: "update", DELETE: "delete", HEAD: "head" }

const flags = parseFlags(process.argv.slice(2))
const collection = JSON.parse(readFileSync(flags.spec, "utf8"))

const requests = collect(collection)
if (requests.length === 0) fail(`${flags.spec} contains no requests`)

const { operations, merged, report } = normalize(requests)
const rendered = format(render(operations, report), flags.out)

if (flags.check) {
  const current = readOutput(flags.out)
  if (current === rendered) {
    console.log(`up to date — ${operations.length} operations`)
    process.exit(0)
  }
  console.error(`${flags.out} is out of date — run \`pnpm catalog:generate\``)
  process.exit(1)
}

mkdirSync(dirname(flags.out), { recursive: true })
writeFileSync(flags.out, rendered)

console.log(`wrote ${flags.out}`)
console.log(`  Braze requests:      ${report.requests}`)
console.log(`  operations:          ${operations.length}`)
console.log(`  reads / writes:      ${report.reads} / ${report.writes}`)
console.log(`  duplicate requests:  ${merged.length}${merged.length > 0 ? " (same method and path, merged)" : ""}`)
console.log(`  commands needing a method to stay unique: ${report.disambiguated}`)
for (const duplicate of merged) console.log(`    merged: ${duplicate.method} ${duplicate.path} — ${duplicate.name}`)

/** Depth-first, in collection order, so every id and every merge is deterministic. */
function collect(node, folders = []) {
  const found = []

  for (const item of node.item ?? []) {
    if (Array.isArray(item.item)) {
      found.push(...collect(item, [...folders, item.name]))
    } else if (item.request) {
      found.push({ ...describe(item, folders), sourceId: item.id ?? item._postman_id })
    }
  }
  return found
}

function describe(item, folders) {
  const url = item.request.url
  const raw = typeof url === "string" ? url : (url?.raw ?? "")
  const path = raw
    .replace(/^\{\{[^}]+\}\}/, "")
    .replace(/^https?:\/\/[^/]*/, "")
    .split("?")[0]
    .replace(/\/$/, "")

  return {
    folders,
    name: item.name,
    method: (item.request.method ?? "GET").toUpperCase(),
    path,
    description: firstSentence(item.request.description ?? item.description),
    queryParameters: queryOf(url, raw),
  }
}

/**
 * Both shapes, because this collection only uses one of them and it is not the documented one:
 * all 99 URLs are plain strings with the query inline, and reading only Postman's structured
 * `url.query` array yielded zero parameters for all 40 requests that have them (BUG-4).
 */
function queryOf(url, raw) {
  const structured =
    typeof url === "object" && url !== null && Array.isArray(url.query)
      ? url.query
          .filter((parameter) => parameter?.key && parameter.disabled !== true)
          .map((parameter) => ({ name: parameter.key, description: parameter.description, example: parameter.value }))
      : []

  const inline = (raw.split("?")[1] ?? "")
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=")
      const name = separator === -1 ? pair : pair.slice(0, separator)
      const example = separator === -1 ? undefined : pair.slice(separator + 1)
      return { name: decodeURIComponent(name), example }
    })
    .filter((parameter) => parameter.name)

  const seen = new Set()
  const merged = []

  for (const parameter of [...structured, ...inline]) {
    if (seen.has(parameter.name)) continue
    seen.add(parameter.name)

    const description = firstSentence(parameter.description)
    // A Postman variable is that collection's own placeholder, not a value anyone can send.
    const example =
      parameter.example && !String(parameter.example).includes("{{") ? String(parameter.example) : undefined

    merged.push({ name: parameter.name, ...(description ? { description } : {}), ...(example ? { example } : {}) })
  }
  return merged
}

function normalize(requests) {
  const byId = new Map()
  const merged = []

  for (const request of requests) {
    if (!request.path) fail(`${request.method} "${request.name}" has no path — cannot generate an operation`)

    const id = identify(request)
    const existing = byId.get(id)

    if (!existing) {
      byId.set(id, { ...request, id, pathParameters: parametersOf(request.path) })
      continue
    }
    // FIND-15: four endpoints are documented twice, once per channel. Same method and same path
    // means one operation, and the second request is recorded rather than dropped (§12).
    if (existing.method === request.method && existing.path === request.path) {
      merged.push(request)
      continue
    }
    fail(
      `two different endpoints derive the id "${id}":\n` +
        `  ${existing.method} ${existing.path} (${existing.name})\n` +
        `  ${request.method} ${request.path} (${request.name})\n` +
        "Give one of them an override, or change the id scheme — never let an operation vanish.",
    )
  }

  const operations = [...byId.values()]
  const { commands, escalated } = assignCommands(operations)

  for (const operation of operations) operation.command = commands.get(operation.id)

  const names = new Set(operations.map((operation) => operation.command.join(" ")))
  if (names.size !== operations.length) fail("two operations ended up with the same command name")

  return {
    operations,
    merged,
    report: {
      requests: requests.length,
      reads: operations.filter((operation) => isRead(operation.method)).length,
      writes: operations.filter((operation) => !isRead(operation.method)).length,
      disambiguated: escalated.size,
    },
  }
}

/**
 * Deterministic and independent of everything else in the collection, because `Operation.id` is
 * promised stable across regenerations. A "shortest unique id" scheme would be prettier and would
 * silently RENAME `users.track` the day Braze adds a second method on that path.
 *
 * Measured over the 99-request snapshot: this is the only scheme of four tried that gives no
 * collision between two different endpoints.
 */
function identify(request) {
  const segments = request.path
    .split("/")
    .filter(Boolean)
    .map((segment) => (isParameter(segment) ? "by-id" : slug(segment)))

  return [...segments, VERBS[request.method] ?? request.method.toLowerCase()].join(".")
}

/**
 * Three tiers, each used only when the one before it collides: the bare path, then the path plus
 * a verb, then the path with its parameter positions marked. The last tier is the id's own shape,
 * so it is unique by construction and the escalation always terminates.
 *
 * Unlike the id this carries no stability promise — §10 says command names are an override's job,
 * and the report counts every operation that needed a tier above the first.
 */
function assignCommands(operations) {
  const tiers = [
    (operation) => withoutParameters(operation),
    (operation) => [...withoutParameters(operation), VERBS[operation.method]],
    (operation) => [...marked(operation), VERBS[operation.method]],
  ]

  const commands = new Map()
  const escalated = new Set()
  let remaining = operations

  for (const [tier, derive] of tiers.entries()) {
    const grouped = new Map()
    for (const operation of remaining) {
      const key = derive(operation).join(" ")
      grouped.set(key, [...(grouped.get(key) ?? []), operation])
    }

    const stillColliding = []
    for (const sharing of grouped.values()) {
      if (sharing.length === 1) {
        commands.set(sharing[0].id, derive(sharing[0]))
        if (tier > 0) escalated.add(sharing[0].id)
      } else {
        stillColliding.push(...sharing)
      }
    }

    remaining = stillColliding
    if (remaining.length === 0) return { commands, escalated }
  }

  fail(
    "these operations cannot be told apart by command name even with their parameters marked:\n" +
      remaining.map((operation) => `  ${operation.id} — ${operation.method} ${operation.path}`).join("\n"),
  )
}

function withoutParameters(operation) {
  return operation.path
    .split("/")
    .filter((segment) => segment && !isParameter(segment))
    .map(slug)
}

function marked(operation) {
  return operation.path
    .split("/")
    .filter(Boolean)
    .map((segment) => (isParameter(segment) ? "by-id" : slug(segment)))
}

function parametersOf(path) {
  return path
    .split("/")
    .filter(isParameter)
    .map((segment) => segment.replace(/^[{:]+/, "").replace(/}+$/, ""))
}

function isParameter(segment) {
  return segment.startsWith("{") || segment.startsWith(":")
}

function slug(segment) {
  return segment.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function isRead(method) {
  return method === "GET" || method === "HEAD"
}

/** Postman descriptions are HTML. One plain sentence is worth more than a paragraph of markup. */
function firstSentence(text) {
  if (typeof text !== "string") return undefined

  const plain = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!plain) return undefined

  const sentence = plain.split(/(?<=[.!?])\s/)[0].trim()
  return sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence
}

function render(operations, report) {
  const body = operations.map(renderOperation).join(",\n")

  return `// GENERATED by scripts/generate-catalog.mjs from ${flags.spec}. Do not edit by hand —
// run \`pnpm catalog:generate\`. Corrections belong in the overrides (CAT-4), which merge on top:
// this file is replaced wholesale on every sync, and an edit here is lost without a trace.
//
// ${report.requests} Braze requests became ${operations.length} operations: ${report.reads} read, ${report.writes} write.
import { defineOperation, type Operation } from "../operation.js"

export const generatedOperations: readonly Operation[] = [
${body},
]
`
}

/** JSON.stringify packs arrays tightly; biome wants a space after each comma. */
function list(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`
}

function queryList(parameters) {
  const entries = parameters.map((parameter) => {
    const fields = [`name: ${JSON.stringify(parameter.name)}`]
    if (parameter.description) fields.push(`description: ${JSON.stringify(parameter.description)}`)
    if (parameter.example) fields.push(`example: ${JSON.stringify(parameter.example)}`)
    return `{ ${fields.join(", ")} }`
  })
  return `[${entries.join(", ")}]`
}

function renderOperation(operation) {
  const fields = [
    `id: ${JSON.stringify(operation.id)}`,
    `command: ${list(operation.command)}`,
    `method: ${JSON.stringify(operation.method)}`,
    `path: ${JSON.stringify(operation.path)}`,
    // By HTTP method, exactly as `braze api` does. It is wrong for a read Braze implemented as a
    // POST, and that is corrected one endpoint at a time in the overrides — FIND-13.
    `access: ${JSON.stringify(isRead(operation.method) ? "read" : "write")}`,
    `sourceId: ${JSON.stringify(operation.sourceId ?? null)}`,
  ]

  if (operation.pathParameters.length > 0) fields.push(`pathParameters: ${list(operation.pathParameters)}`)
  if (operation.queryParameters.length > 0) fields.push(`queryParameters: ${queryList(operation.queryParameters)}`)
  if (operation.description) fields.push(`description: ${JSON.stringify(operation.description)}`)

  return `  defineOperation({\n${fields.map((field) => `    ${field},`).join("\n")}\n  })`
}

/**
 * Through biome rather than by hand: the only thing left to get right is where to break a long
 * description, and reimplementing that would drift from the formatter on the first disagreement.
 * Formatting before the `--check` comparison is what keeps `catalog:check` from always failing.
 */
function format(source, outputPath) {
  try {
    return execFileSync("npx", ["biome", "format", `--stdin-file-path=${outputPath}`], {
      input: source,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
  } catch (error) {
    fail(`biome could not format the generated catalog: ${error.message}`)
  }
}

function readOutput(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

function parseFlags(argv) {
  const flags = { check: false, spec: DEFAULT_SPEC, out: DEFAULT_OUT }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--check") {
      flags.check = true
      continue
    }
    if (arg !== "--spec" && arg !== "--out") fail(`unknown argument: ${arg}`)

    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a path`)

    if (arg === "--spec") flags.spec = value
    else flags.out = value
    index += 1
  }
  return flags
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
