// The gate a lint rule cannot see: bundle core for a runtime with NO builtins at all.
// Biome catches `import "node:fs"` and a bare `process` in our own source; this catches the
// same thing arriving through a dependency, where there is nothing of ours to lint.
//
// `platform: "neutral"` is the strict setting — esbuild resolves no builtins and no Node
// conditions, so an unresolvable `node:fs` fails the build. Verified 2026-09-13:
// `bun build --target=browser` is NOT a substitute, it silently rewrites `node:fs` to `{}`
// and exits 0.
import { build } from "esbuild"

// Usage shapes, not bare words. A bare /\bprocess\b/ matched the sentence "the queue will
// process records" inside a string literal and failed a clean bundle — measured 2026-09-13.
// A gate that cries wolf gets deleted, and this is the only layer that sees dependencies.
//
// Our own source has two stricter checks on top of this one: Biome's noRestrictedGlobals over
// packages/core, and `"types": []` in packages/core/tsconfig.json. Those are the authority on
// globals; this scan is a backstop for code we did not write.
const bannedUsage = [
  { name: "process", pattern: /\bprocess\s*\.\s*[A-Za-z_$]/ },
  { name: "process", pattern: /\btypeof\s+process\b/ },
  { name: "Buffer", pattern: /\bBuffer\s*\.\s*[A-Za-z_$]/ },
  { name: "Buffer", pattern: /\bnew\s+Buffer\b/ },
  { name: "__dirname", pattern: /\b__dirname\b/ },
  { name: "__filename", pattern: /\b__filename\b/ },
]

// Every published entry of core, including the test kit — a mock reaching for a timer or a
// Node builtin is exactly the regression this exists for, and it is the file most likely to.
// Explicit entries also let the fixtures in tests/fixtures/portability check that this gate
// still fires, and still stays quiet on prose that merely contains the word.
const entries =
  process.argv.length > 2 ? process.argv.slice(2) : ["packages/core/src/index.ts", "packages/core/src/testing/index.ts"]

for (const entry of entries) {
  await check(entry)
}

async function check(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2023",
    write: false,
    logLevel: "silent",
  }).catch((error) => {
    console.error(`${entry} does not bundle for a neutral runtime:\n`)
    console.error(error.message)
    process.exit(1)
  })

  const code = result.outputFiles[0].text
  const found = [...new Set(bannedUsage.filter(({ pattern }) => pattern.test(code)).map(({ name }) => name))]

  if (found.length > 0) {
    console.error(`${entry} uses Node-only globals: ${found.join(", ")}`)
    console.error("They belong in packages/cli. See docs/ARCHITECTURE.md.")
    process.exit(1)
  }

  const bytes = new TextEncoder().encode(code).length
  console.log(`${entry} bundles for a neutral runtime: ${bytes} bytes, no Node globals`)
}
