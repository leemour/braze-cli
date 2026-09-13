# Testing

**Status (2026-09-13):** the harness is in place and green — 17 tests, 3 files. The layers below
that do not exist yet are marked *not built*. Nothing here describes a test that has not been run.

```sh
pnpm test                 # vitest, whole workspace
pnpm test:watch
pnpm lint                 # biome: format + lint, includes the core Node ban
pnpm typecheck            # tsc --build, includes core's `types: []` isolation
pnpm portability:core     # bundles core for a runtime with no builtins
pnpm smoke:bun            # executes core under bun, the second runtime
pnpm build
```

CI runs all of these — [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

---

## The rule: a skip is not a pass

A skipped test, a mocked-away assertion and a test that would pass with the feature deleted all
report green. When reporting work done, say which suite ran and paste the counts. "Tests pass" is
a claim, and it has to be true.

## What runs where

| Layer | Location | Runner | State |
|---|---|---|---|
| Core unit | `packages/core/src/**/*.test.ts` | vitest | 13 tests |
| CLI unit | `packages/cli/src/**/*.test.ts` | vitest | *not built* |
| Cross-cutting | `tests/**/*.test.ts` | vitest | 1 test (portability gate) |
| Generator | `tests/generator/**` against committed fixtures | vitest | *not built* |
| Live Braze | `pnpm test:live` | vitest | *not built* |

Vitest runs **without globals** (`vitest.config.ts`). Import `describe`/`it`/`expect` from
`"vitest"` explicitly — injected globals would need a `types` entry in `packages/core/tsconfig.json`,
which is exactly the door `"types": []` is holding shut.

## Three gates that are not ordinary tests

### Core portability

Three layers, described in [`ARCHITECTURE.md`](ARCHITECTURE.md) §3. The gate itself is tested:
`tests/core-portability.test.ts` runs the bundler script and fails if it stops refusing.

To check a gate still bites, put this in `packages/core/src/__canary.ts`, export it from
`index.ts`, and confirm all three go red — then delete it:

```ts
export const home = () => process.env.HOME
```

### The machine-output invariant

*Not built — lands with the output module in Phase 1.* In `--json` and `--jsonl` modes,
**stdout carries data and nothing else**: no spinner frame, no `✓`, no warning, no progress bar,
no ANSI. Diagnostics go to stderr. The test pipes a real command and asserts stdout parses as a
single JSON value with a byte-for-byte match on the serialized form.

This is the invariant agents depend on, so it is tested rather than trusted.
[`REQUIREMENTS.md`](REQUIREMENTS.md) §44.

### Braze is never contacted by the normal suite

Unit tests inject a fake `fetch` — `mockBraze` from `brazecli-core/testing`, which scripts
success, every status the brief names, invalid JSON, a network failure, a connection dropped
after the request was sent, and a request that hangs until the caller aborts:

```ts
import { brazeResponses, mockBraze } from "brazecli-core/testing"

const braze = mockBraze([brazeResponses.rateLimited({ retryAfterSeconds: 2 }), brazeResponses.ok()])
const client = new BrazeClient({ fetch: braze.fetch, sleep: noSleep })

expect(braze.requests).toHaveLength(2)
```

It has no delay option and touches no clock: `hangsUntilAborted` settles when the caller's signal
fires, so a timeout test costs nothing. A call past the end of the script is counted in
`braze.unexpectedCalls` and rejected with an obviously-not-Braze error, so a client that retries
too often cannot make a test pass for the wrong reason. A suite
that reaches the real Braze fails for reasons that have nothing to do with the change under test.
`pnpm test:live` is separate, opt-in, and **read-only** — a live write needs a second explicit
opt-in and a dedicated profile, if it is ever introduced at all.

## What to write

Trophy shape: prefer the test that pins a contract someone could plausibly break over the one that
restates the implementation. The tests worth having here are the mismatched pairs — a write that
was not confirmed must not send; a batch Braze accepted without per-record acknowledgement must be
recorded as `submitted`, never `success`; a connection that died after the request left must become
`outcome_unknown`, never `failed`.

Deterministic time: inject `sleep` and `clock` into `BrazeClient` rather than waiting. A retry test
that actually sleeps 250 ms is a retry test nobody runs.
