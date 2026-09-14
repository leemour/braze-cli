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
const OVERRIDES = "packages/core/src/operations/overrides.ts"
const COVERAGE = "docs/catalog-coverage.md"

// Braze's own paths carry the action, so `/campaigns/list` needs no verb from us. Only the
// REST-shaped resources (catalogs, scim, preference_center) do, and there the method is the verb.
const VERBS = { GET: "get", POST: "create", PUT: "replace", PATCH: "update", DELETE: "delete", HEAD: "head" }

// Words Braze puts in the path of an endpoint that only reads. A POST carrying one of these and
// no override is the FIND-13 shape: a read the CLI refuses on a read-only profile because it
// judged by method. §12 calls that an unclassified endpoint and wants CI to fail on it.
// "status" is deliberately absent: Braze writes through `/subscription/status/set` and
// `/email/status`, so it flagged three genuine writes and would have trained anyone to ignore this.
const READING_WORDS = ["export", "list", "details", "data_series", "data_summary", "info"]

const flags = parseFlags(process.argv.slice(2))
const collection = JSON.parse(readFileSync(flags.spec, "utf8"))

const requests = collect(collection)
if (requests.length === 0) fail(`${flags.spec} contains no requests`)

const { operations, merged, report } = normalize(requests)

// By text, not by import: this file is plain JS and overrides.ts is TypeScript. Reading the keys
// is enough — whether each override is VALID is checked where it is applied, with a real type.
const corrected = overrideIds()
const unclassified = ambiguous(operations, corrected)

const rendered = format(render(operations, report), flags.out)
const coverage = renderCoverage(operations, merged, report, corrected, unclassified)

if (unclassified.length > 0) {
  // §12: CI fails on an endpoint nobody has classified, rather than shipping a read that the
  // CLI will refuse. Fix it with an override, or add it to the list of known writes.
  console.error("these look like reads Braze implemented as writes, and no override says either way:")
  for (const operation of unclassified) console.error(`  ${operation.id} — ${operation.method} ${operation.path}`)
  console.error(`\nGive each one an entry in ${OVERRIDES}, with a reason.`)
  process.exit(1)
}

if (flags.check) {
  const stale = [
    readOutput(flags.out) === rendered ? undefined : flags.out,
    readOutput(flags.coverage) === coverage ? undefined : flags.coverage,
  ].filter(Boolean)

  if (stale.length === 0) {
    console.log(`up to date — ${operations.length} operations, ${corrected.size} overridden`)
    process.exit(0)
  }
  console.error(`out of date, run \`pnpm catalog:generate\`: ${stale.join(", ")}`)
  process.exit(1)
}

mkdirSync(dirname(flags.out), { recursive: true })
writeFileSync(flags.out, rendered)
mkdirSync(dirname(flags.coverage), { recursive: true })
writeFileSync(flags.coverage, coverage)

console.log(`wrote ${flags.out}`)
console.log(`  Braze requests:      ${report.requests}`)
console.log(`  operations:          ${operations.length}`)
console.log(`  reads / writes:      ${report.reads} / ${report.writes}`)
console.log(`  duplicate requests:  ${merged.length}${merged.length > 0 ? " (same method and path, merged)" : ""}`)
console.log(`  overridden by hand:  ${corrected.size}`)
console.log(`  unclassified:        0`)
console.log(`  commands needing a method to stay unique: ${report.disambiguated}`)
console.log(`wrote ${flags.coverage}`)
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

  const names = operations.map((operation) => operation.command.join(" "))
  if (new Set(names).size !== names.length) fail("two operations ended up with the same command name")

  const shadowed = names.filter((name) => names.some((other) => other.startsWith(`${name} `)))
  if (shadowed.length > 0) fail(`a command cannot also be a group: ${shadowed.join(", ")}`)

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
    (operation) => [...withoutParameters(operation), countedVerb(operation)],
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
    if (remaining.length === 0) return resolvePrefixes(operations, commands, escalated)
  }

  fail(
    "these operations cannot be told apart by command name even with their parameters marked:\n" +
      remaining.map((operation) => `  ${operation.id} — ${operation.method} ${operation.path}`).join("\n"),
  )
}

/**
 * A command that is a strict prefix of another cannot be registered: `sms invalid-phone-numbers`
 * would have to be a command AND the group holding `sms invalid-phone-numbers remove`, which
 * Commander refuses outright. The shorter one takes its verb.
 */
function resolvePrefixes(operations, commands, escalated) {
  for (let pass = 0; pass < 4; pass += 1) {
    const names = new Map([...commands].map(([id, words]) => [words.join(" "), id]))
    let changed = false

    for (const [name, id] of names) {
      const shadowed = [...names.keys()].some((other) => other.startsWith(`${name} `))
      if (!shadowed) continue

      const operation = operations.find((candidate) => candidate.id === id)
      commands.set(id, [...commands.get(id), VERBS[operation.method]])
      escalated.add(id)
      changed = true
    }
    if (!changed) return { commands, escalated }
  }
  fail("command names could not be made free of prefixes")
}

/**
 * What separates `/catalogs/{name}/items` from `/catalogs/{name}/items/{id}` is one versus many,
 * and that is how a CLI should say it: `items list` and `items get`, not two `items get`s told
 * apart by a `by-id` word nobody wants to type. Only reached when the plain verb collided.
 */
function countedVerb(operation) {
  const endsWithParameter = isParameter(operation.path.split("/").filter(Boolean).at(-1) ?? "")
  if (endsWithParameter) return VERBS[operation.method]

  return operation.method === "GET" ? "list" : `${VERBS[operation.method]}-many`
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

function looksLikeARead(operation) {
  return operation.path
    .split("/")
    .filter(Boolean)
    .some((segment) => READING_WORDS.includes(segment))
}

function ambiguous(operations, corrected) {
  return operations.filter(
    (operation) => !isRead(operation.method) && looksLikeARead(operation) && !corrected.has(operation.id),
  )
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

function overrideIds() {
  const source = readOutput(OVERRIDES)
  if (source === undefined) return new Set()

  // Only the keys of the exported record: `"users.track.create": {`.
  return new Set([...source.matchAll(/^\s{2}"([^"]+)":\s*\{/gm)].map((match) => match[1]))
}

function renderCoverage(operations, merged, report, corrected, unclassified) {
  const rows = [
    ["Braze requests", report.requests],
    ["duplicate requests merged", merged.length],
    ["operations generated", operations.length],
    ["reads", report.reads],
    ["writes", report.writes],
    ["corrected by an override", corrected.size],
    ["unclassified or ambiguous", unclassified.length],
  ]

  const byResource = new Map()
  for (const operation of operations) {
    const resource = operation.command[0]
    byResource.set(resource, (byResource.get(resource) ?? 0) + 1)
  }

  return `# Catalog coverage

GENERATED by \`pnpm catalog:generate\`. Do not edit by hand.

Source: [\`${DEFAULT_SPEC}\`](../${DEFAULT_SPEC}), whose provenance is in
[\`spec/provenance.json\`](../spec/provenance.json).

| | |
|---|---:|
${rows.map(([label, value]) => `| ${label} | ${value} |`).join("\n")}

**\`unclassified or ambiguous\` must stay at zero** — \`pnpm catalog:check\` fails CI otherwise. It
counts operations Braze implements as a write whose path reads like a query (\`export\`, \`list\`,
\`details\`, …) and which no override has ruled on either way. That is the shape of \`FIND-13\`, where
a read implemented as a POST was refused on a read-only profile.

A number nobody blocks on is a number nobody reads, which is why this is a gate and not a report.

## Operations by resource

| Resource | Operations |
|---|---:|
${[...byResource.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([resource, count]) => `| \`${resource}\` | ${count} |`)
  .join("\n")}

## Corrected by hand

These carry a fact the Postman collection does not. Each one's reason is in
[\`${OVERRIDES}\`](../${OVERRIDES}).

${[...corrected]
  .sort()
  .map((id) => `- \`${id}\``)
  .join("\n")}
`
}

function readOutput(path) {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return undefined
  }
}

function parseFlags(argv) {
  const flags = { check: false, spec: DEFAULT_SPEC, out: DEFAULT_OUT, coverage: COVERAGE }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--check") {
      flags.check = true
      continue
    }
    if (arg !== "--spec" && arg !== "--out" && arg !== "--coverage") fail(`unknown argument: ${arg}`)

    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a path`)

    if (arg === "--spec") flags.spec = value
    else if (arg === "--coverage") flags.coverage = value
    else flags.out = value
    index += 1
  }
  return flags
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
