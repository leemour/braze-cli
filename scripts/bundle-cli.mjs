#!/usr/bin/env node
/**
 * Builds the one thing that gets published: `packages/cli/dist/bin/braze.js`, with `brazecli-core`
 * inlined and every third-party dependency left as an import.
 *
 * Two source packages, one npm package (`NEED-47`). The seam between them is a development
 * discipline — three gates enforce it — not something a user of the CLI has any reason to install
 * separately.
 *
 * **The output path matches what `tsc` emits on purpose.** `braze skill install` finds `SKILL.md`
 * relative to `import.meta.url`, so bundling to a different depth would break it in the published
 * package and nowhere else.
 */
import { chmodSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const packageDir = join(root, "packages/cli")
const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"))

/**
 * Everything a consumer installs stays external; anything else is inlined. Derived from the
 * manifest rather than listed here, so the two cannot disagree.
 */
const external = Object.keys(manifest.dependencies ?? {})
const outfile = join(packageDir, "dist/bin/braze.js")

const result = await build({
  entryPoints: [join(packageDir, "src/bin/braze.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
  metafile: true,
  logLevel: "warning",
})

const packageOf = (specifier) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]

const imported = new Set(
  Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports ?? [])
    .filter((entry) => entry.external && !entry.path.startsWith("node:"))
    .map((entry) => packageOf(entry.path)),
)

/**
 * The failure this catches is invisible here and fatal there: a package core depends on resolves
 * fine inside the workspace, is absent from the CLI's own dependencies, and is therefore missing
 * on the machine that installed `brazecli`. `p-queue` arrived exactly that way.
 */
const missing = [...imported].filter((name) => !external.includes(name))
if (missing.length > 0) {
  console.error(`The bundle imports packages brazecli does not depend on: ${missing.join(", ")}`)
  console.error("Add them to packages/cli/package.json, or they will be absent after an install.")
  process.exit(1)
}

chmodSync(outfile, 0o755)

const bytes = Object.values(result.metafile.outputs).find((output) => output.entryPoint)?.bytes ?? 0
console.log(`bundled ${outfile.slice(root.length + 1)} — ${Math.round(bytes / 1024)} kB, ${external.length} external`)
