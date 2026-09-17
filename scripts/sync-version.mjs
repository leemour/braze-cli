#!/usr/bin/env node
/**
 * One version, four files.
 *
 * `packages/cli/package.json` is the source of truth. `braze --version`, the `User-Agent` sent to
 * Braze and every run's `run.json` all read a compiled constant, so a manifest bumped alone makes
 * the tool report a version that does not exist — to the user, to Braze, and into the audit.
 *
 * `--check` is the CI gate, in the shape the repository already uses for the spec, the catalog
 * and the generated docs.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const check = process.argv.includes("--check")

const cliManifest = join(root, "packages/cli/package.json")
const version = JSON.parse(readFileSync(cliManifest, "utf8")).version

const targets = [
  {
    path: join(root, "packages/core/package.json"),
    read: (text) => JSON.parse(text).version,
    write: (text) => text.replace(/("version":\s*)"[^"]*"/, `$1"${version}"`),
  },
  {
    path: join(root, "packages/cli/src/version.ts"),
    read: (text) => text.match(/"([^"]*)"/)?.[1],
    write: () => `export const VERSION = "${version}"\n`,
  },
  {
    path: join(root, "packages/cli/skills/braze/SKILL.md"),
    read: (text) => text.match(/^version:\s*(\S+)$/m)?.[1],
    write: (text) => text.replace(/^version:\s*\S+$/m, `version: ${version}`),
  },
]

const stale = []

for (const target of targets) {
  const text = readFileSync(target.path, "utf8")
  if (target.read(text) === version) continue

  stale.push(target.path.slice(root.length + 1))
  if (!check) writeFileSync(target.path, target.write(text))
}

if (stale.length === 0) {
  console.log(`version ${version} — everything agrees`)
  process.exit(0)
}

if (check) {
  console.error(`These do not say ${version}, which packages/cli/package.json does:`)
  for (const path of stale) console.error(`  ${path}`)
  console.error("\nRun `pnpm version:sync`.")
  process.exit(1)
}

console.log(`version ${version} — updated ${stale.join(", ")}`)
