// The gate a lint rule cannot see: bundle core for a runtime with NO builtins at all.
// Biome catches `import "node:fs"` and a bare `process` in our own source; this catches the
// same thing arriving through a dependency, where there is nothing to lint.
//
// `platform: "neutral"` is the strict setting — esbuild resolves no builtins and no Node
// conditions. Verified 2026-09-13: `bun build --target=browser` is NOT a substitute, it
// silently rewrites `node:fs` to `{}` and exits 0.
import { build } from "esbuild"

const banned = ["process", "Buffer", "__dirname", "__filename", "require", "global"]

const result = await build({
  entryPoints: ["packages/core/src/index.ts"],
  bundle: true,
  platform: "neutral",
  format: "esm",
  target: "es2023",
  write: false,
  logLevel: "silent",
  metafile: true,
}).catch((error) => {
  console.error("core does not bundle for a neutral runtime:\n")
  console.error(error.message)
  process.exit(1)
})

const code = result.outputFiles[0].text
const found = banned.filter((name) => new RegExp(`\\b${name}\\b`).test(code))

if (found.length > 0) {
  console.error(`core bundle references Node-only globals: ${found.join(", ")}`)
  console.error("They belong in packages/cli. See docs/ARCHITECTURE.md.")
  process.exit(1)
}

const bytes = new TextEncoder().encode(code).length
console.log(`core bundles for a neutral runtime: ${bytes} bytes, no Node globals`)
