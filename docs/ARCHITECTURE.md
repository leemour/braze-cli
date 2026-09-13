# Architecture

How this repository is put together and, more usefully, which seams you are not allowed to cross.

**Status (2026-09-13):** scaffold only. The workspace, the linter, the portability gates, CI and
the docs exist and are verified. `packages/core` holds the logger interface and the error model;
`packages/cli` holds a placeholder entry point. Nothing talks to Braze yet — that is Phase 1,
planned in [`plans/2026-09-13-phase-1-foundation.md`](plans/2026-09-13-phase-1-foundation.md).

Source brief: [`REQUIREMENTS.md`](REQUIREMENTS.md) §2–§5, §18–§19, §61.

---

## 1. Two packages, one direction

```text
                       portable — no Node, no filesystem, no terminal
                 ┌──────────────────────────────────────────────┐
                 │  brazecli-core          packages/core        │
                 │                                              │
                 │  BrazeClient · operations · Valibot schemas  │
                 │  retry · pagination · batching · bulk queue  │
                 │  error model · Logger interface              │
                 └───────────────────────┬──────────────────────┘
                                         │ adapters only
                 ┌───────────────────────▼──────────────────────┐
                 │  brazecli               packages/cli         │
                 │                                              │
                 │  Commander · keyring · config files · Pino   │
                 │  Clack · colors · tables · CSV · run dirs    │
                 └──────────────────────────────────────────────┘
```

`cli` depends on `core`. **`core` never depends on `cli`, and never learns that a CLI exists.**

Why two packages and not one: the client is meant to run in a Cloudflare Worker, in a browser and
in a serverless function, unchanged. That is a stated product requirement, not a hypothetical, and
a single package would make every Node import a silent future breakage.

## 2. What core may use

Web Platform only: `fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`,
`AbortController`, `Blob`, `FormData`, `crypto.randomUUID()`, `performance.now()`, `setTimeout`,
`ReadableStream`.

Not in core: `node:*` of any kind, `Buffer`, `process`, `process.env`, Pino, Commander, Clack,
keyring, config files, anything that formats a terminal.

**Everything the environment knows is passed in.** Core does not read `process.env.BRAZE_API_KEY`;
the CLI reads it and hands it to `BrazeClient`. Core does not know where a config file lives, what
a TTY is, or which profile is selected.

## 3. The portability gate has three layers, and each catches what the others miss

| Layer | Where | Catches | Misses |
|---|---|---|---|
| Biome rules | `biome.json`, `overrides` for `packages/core/**` | `import "node:fs"`, bare `process`/`Buffer`/`window` **in our own source** | anything arriving through a dependency |
| `"types": []` | `packages/core/tsconfig.json` | `process` typechecking clean because `@types/node` leaked in through the workspace | runtime-only usage |
| neutral bundle | `scripts/check-core-portability.mjs` | a **dependency** importing a Node builtin — there is no source of ours to lint | nothing so far |

The bundle checks **every published entry of core**, `.` and `./testing`. The test kit is the file
most likely to reach for a timer or a Node builtin, and it ships to consumers like the rest.

All three were verified on 2026-09-13 by putting a canary
(`export const home = () => process.env.HOME`) into `packages/core/src` and confirming each one
goes red. Run them with `pnpm lint`, `pnpm typecheck`, `pnpm portability:core`.

**Biome and `types: []` are the authority on globals; the bundle is the authority on imports.**
The bundle also scans for Node globals, but only in usage shapes (`process.`, `typeof process`,
`new Buffer`) rather than as bare words — a plain `/\bprocess\b/` matched the English sentence
"the queue will process records" inside a string literal and failed a clean bundle. A gate that
cries wolf gets switched off, so its calibration is tested in both directions:
`tests/core-portability.test.ts` asserts it fires on a real `process.env`, fires on a `node:`
import, and stays quiet on that sentence.

⚠ **`bun build --target=browser` is not a substitute for the neutral bundle.** It rewrites
`node:fs` to `{}` and exits 0 — green build, runtime failure. Bun's role here is different: it is
the **second runtime**, and `pnpm smoke:bun` actually executes core under it.

## 4. Dependency injection, kept small

`BrazeClient` takes its environment as plain functions:

```ts
new BrazeClient({ fetch, sleep, clock, random, logger })
```

Defaults are `globalThis.fetch`, a real `setTimeout` sleep, `Date.now`, `Math.random` and
`noopLogger`. That is the whole mechanism — there is no container, no decorator, no registry. It
exists so retry and backoff can be tested without waiting, and so a Worker can pass its own fetch.

## 5. Logging is not rendering

Two separate concepts that must never merge:

- **Logger** — structured records for machines. JSON lines, persisted to a run's `events.jsonl`.
  No ANSI, no colour, no decoration. Core only knows the four-method `Logger` interface; the CLI
  adapts Pino to it.
- **Renderer** — the terminal surface for a person. Clack, colours, spinners, tables, emoji.

A spinner frame must never reach a log file, and a log record must never reach stdout in JSON
mode. [`TESTING.md`](TESTING.md) describes the test that holds this line.

## 6. Where the API catalog comes from

Braze has hundreds of endpoints. Neither hand-writing them nor fetching them at startup is
acceptable, so:

```text
official Braze collection → (explicit dev-time sync) → spec/braze.postman.json (committed)
  → generator → generated catalog + coverage report
  → + handwritten overrides → bundled operation manifest → dynamically registered commands
```

The committed snapshot is what ships. A change in Braze's API therefore arrives as a reviewable Git
diff rather than as a silent change in the installed CLI's behaviour.

⚠ **Unverified:** that the official collection can be exported by script at all. Every guessed
source URL returned 404 on 2026-09-13 — see `RISK-1` in
[`journal/2026-09-13-repo-setup.md`](journal/2026-09-13-repo-setup.md). Phase 2 opens with a probe
and carries a fallback branch.

## 7. Trade-off order

When two of these conflict, the earlier one wins:

```text
correctness > safety > auditability > agent determinism > portability > debuggability
> human UX > implementation cleverness
```
