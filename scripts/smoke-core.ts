// Second runtime. Core claims to run outside Node; this proves one non-Node runtime
// actually imports and executes it. Run: `bun run scripts/smoke-core.ts`.
import { BrazeError, errorCodes, noopLogger } from "../packages/core/src/index.js"

const error = new BrazeError("timeout", "smoke", { attempts: 2 })
noopLogger.info({ event: "smoke" })

if (error.code !== "timeout" || errorCodes.length === 0) {
  throw new Error("core did not behave under this runtime")
}

console.log(`core runs under ${typeof Bun !== "undefined" ? `bun ${Bun.version}` : "an unknown runtime"}`)
