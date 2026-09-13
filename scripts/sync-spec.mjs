// Dev-time only. Downloads Braze's Postman collection and commits it, so a change on Braze's
// side arrives as a reviewable git diff instead of silently changing an installed CLI
// (REQUIREMENTS §6–§8). The runtime never fetches this — it reads the committed snapshot.
//
//   node scripts/sync-spec.mjs                  # fetch, validate, write if changed
//   node scripts/sync-spec.mjs --from c.json    # validate a manual export instead
//   node scripts/sync-spec.mjs --check          # fail if the snapshot is stale; writes nothing
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// Braze's own documentation links here (NEED-13). Not api.getpostman.com, which wants a token
// this repository does not have. It is Postman's internal API and may move without notice
// (RISK-2) — when it does, `--from` takes a manual export and the snapshot's shape is unchanged.
const SOURCE = "https://documenter.getpostman.com/api/collections/4689407/SVYrsdsG"

const SPEC_DIR = "spec"
const COLLECTION_FILE = "braze.postman.json"
const PROVENANCE_FILE = "provenance.json"

const flags = parseFlags(process.argv.slice(2))
const outDir = flags.out ?? SPEC_DIR

const raw = flags.from ? readFileSync(flags.from, "utf8") : await download(SOURCE)
const collection = parseCollection(raw, flags.from ?? SOURCE)
const stats = summarize(collection)

const sourceSha256 = sha256(raw)
const previous = readProvenance(outDir)

if (previous?.sourceSha256 === sourceSha256) {
  console.log(`unchanged — ${stats.requests} requests, sha256 ${short(sourceSha256)}`)
  process.exit(0)
}

if (flags.check) {
  console.error(
    previous
      ? `spec/ is stale: recorded ${short(previous.sourceSha256)}, upstream is ${short(sourceSha256)}`
      : "spec/ has no snapshot yet — run `pnpm spec:sync`",
  )
  process.exit(1)
}

if (previous && stats.requests < previous.requests) {
  // Not fatal: Braze may genuinely retire an endpoint. Loud, because the other cause is a
  // truncated response, and a silently smaller catalog is what §12 forbids. `catalog:check`
  // (CAT-5) is the gate that decides; this is the warning that makes the diff worth reading.
  console.warn(`⚠ the collection SHRANK: ${previous.requests} requests before, ${stats.requests} now`)
}

// Formatted, not as received. The response is one 565 KB line, and a single-line diff tells a
// reviewer nothing — the whole point of committing it is that changes are readable.
const formatted = `${JSON.stringify(collection, null, 2)}\n`

const provenance = {
  source: flags.from ? `manual export: ${flags.from}` : SOURCE,
  syncedAt: new Date().toISOString(),
  sourceCollectionId: collection.info?._postman_id ?? null,
  collectionName: collection.info?.name ?? null,
  schema: collection.info?.schema ?? null,
  requests: stats.requests,
  folders: stats.folders,
  /** Of the bytes as received, so the next sync can tell "Braze changed something" from "no change". */
  sourceSha256,
  /** Of the formatted file in this directory, so the committed artifact can be verified on its own. */
  sha256: sha256(formatted),
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, COLLECTION_FILE), formatted)
writeFileSync(join(outDir, PROVENANCE_FILE), `${JSON.stringify(provenance, null, 2)}\n`)

console.log(`wrote ${join(outDir, COLLECTION_FILE)} — ${stats.requests} requests in ${stats.folders} folders`)
console.log(`source sha256 ${short(sourceSha256)}, file sha256 ${short(provenance.sha256)}`)

function parseFlags(argv) {
  const flags = { check: false }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === "--check") {
      flags.check = true
      continue
    }
    if (arg !== "--from" && arg !== "--out") fail(`unknown argument: ${arg}`)

    const value = argv[index + 1]
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a path`)

    if (arg === "--from") flags.from = value
    else flags.out = value
    index += 1
  }
  return flags
}

async function download(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } }).catch((error) => {
    fail(`could not reach ${url}: ${error.message}`)
  })

  if (!response.ok) fail(`${url} answered ${response.status} ${response.statusText}`)
  return await response.text()
}

/**
 * Refuses anything that is not a Postman collection. This is the whole reason the script is
 * allowed to overwrite a committed file: the failure that would actually hurt is writing an
 * HTML error page or a truncated body into spec/ and committing it (RISK-2).
 */
function parseCollection(raw, origin) {
  if (raw.trimStart().startsWith("<")) fail(`${origin} returned markup, not JSON — the address has probably moved`)

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    fail(`${origin} is not valid JSON: ${error.message}`)
  }

  if (typeof parsed !== "object" || parsed === null) fail(`${origin} is not a JSON object`)
  if (typeof parsed.info?.schema !== "string" || !parsed.info.schema.includes("schema.getpostman.com")) {
    fail(`${origin} has no Postman collection schema in info.schema — it is not a collection`)
  }
  if (!Array.isArray(parsed.item) || parsed.item.length === 0) fail(`${origin} has no items — an empty collection`)

  return parsed
}

function summarize(collection) {
  let requests = 0
  let folders = 0

  const walk = (items) => {
    for (const item of items ?? []) {
      if (Array.isArray(item.item)) {
        folders += 1
        walk(item.item)
      } else if (item.request) {
        requests += 1
      }
    }
  }
  walk(collection.item)

  if (requests === 0) fail("the collection contains folders but no requests")
  return { requests, folders }
}

function readProvenance(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, PROVENANCE_FILE), "utf8"))
  } catch {
    return undefined
  }
}

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

function short(hash) {
  return hash.slice(0, 12)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
