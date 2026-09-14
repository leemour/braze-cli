#!/usr/bin/env node
import { run } from "../program.js"
import { installSignalHandlers } from "../runs/signals.js"

// Here and not in `run()`: the tests call that hundreds of times, and a listener per call
// accumulates until Node warns about a leak.
installSignalHandlers()

process.exitCode = await run(process.argv.slice(2))
