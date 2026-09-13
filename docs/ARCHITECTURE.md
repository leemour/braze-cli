# Architecture

How this repository is put together and, more usefully, which seams you are not allowed to cross.

**Status (2026-09-13):** Phase 1 built and verified against live Braze. `BrazeClient` performs
one timed, cancellable attempt (`send`) under a policy layer that classifies, retries reads and
refuses to guess about writes (`execute`). The CLI has profiles, keyring storage, output modes,
run artifacts and `braze api`. 152 tests.

⚠ **Not built, and load-bearing for everything that follows:** the generated operation catalog
(§6). Until it exists there are no typed commands — every call goes through `braze api`, which
classifies by HTTP method and therefore treats a read like `POST /users/export/ids` as a write.
That is Phase 2.

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
new BrazeClient({ endpoint, apiKey, fetch, sleep, clock, now, random, logger })
```

Defaults are `globalThis.fetch`, a `setTimeout`-backed sleep, `performance.now`, `new Date`,
`Math.random` and `noopLogger`. That is the whole mechanism — no container, no decorator, no
registry. It exists so retry and timeout can be tested without waiting, and so a Worker can pass
its own fetch.

**Two clocks, deliberately not one.** `clock` is monotonic and every duration comes from it — a
wall clock can step backwards and make a duration negative. `now` is wall time, and every
timestamp a person or another system will read comes from it.

**`sleep(ms, signal)` is the only time primitive**, and it serves both the per-attempt timeout and
the retry backoff. A test passes a sleep that resolves at once to force a timeout, or one that
never settles to rule one out. Nothing in the test suite waits.

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

**The source is settled (2026-09-14, `NEED-13`).** The collection comes from Braze's own Postman
documenter, `https://documenter.getpostman.com/api/collections/4689407/SVYrsdsG`, which answers
`200` with the whole collection as JSON and needs no Postman account or token. 99 requests, every
one carrying a distinct Postman id, and three consecutive downloads are byte-identical. So
`spec:sync` downloads rather than validating a hand-made export.

This corrects `RISK-1`, which recorded the source as unconfirmed after three guessed URLs 404'd on
2026-09-13 — none of them this one. Details in [`DECISIONS.md`](DECISIONS.md).

⚠ That address is Postman's internal API rather than a published interface, so it may change
without notice (`RISK-2`). Nothing at runtime depends on it: the committed snapshot is what ships,
and a dead address breaks the developer's `spec:sync`, not an installed CLI. The requirement it
creates is that `spec:sync` verify it received a collection before overwriting `spec/`.

## 7. A 2xx is not proof every record landed

Braze answers `/users/track` with **201 and a populated `errors` array** when some records in the
batch failed. Nothing above the HTTP layer can recover that once it is thrown away, so
`ExecuteResult` carries `raw` — the body exactly as Braze sent it — alongside the parsed `data`.

This is why the audit CSV says `submitted` and not `success` for a record in a batch Braze
accepted: the request succeeded, and whether that particular user was updated is a different
question with a different answer.

## 8. A message from Braze is untrusted data, not text

Braze answers a 401 with `Invalid API key: <the key itself>` in the body. The first real request
ever made from this repository printed a production key to a terminal, because the error handler
passed the provider's message through verbatim (`SEC-1`, 2026-09-13).

`BrazeClient` now redacts its own key out of every message it builds — it is the only component
that holds the secret, so it is the only one that can. **The wider rule: never place a
third-party string into output or a log without treating it as data that came from outside.**
When Phase 2 generates hundreds of operations, that rule has to hold in one place, and one place
is the client.

## 9. Trade-off order

When two of these conflict, the earlier one wins:

```text
correctness > safety > auditability > agent determinism > portability > debuggability
> human UX > implementation cleverness
```
