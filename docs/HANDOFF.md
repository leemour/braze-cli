# brazecli — start here

Read in one pass. Everything else is read for a specific task, not in order.

---

## 1. What this is

A command line interface for the Braze REST API, built first for **AI agents and automation** and
second for people. It aims to cover nearly the whole API while staying safe (no accidental writes),
reproducible (every run leaves artifacts), and deterministic for machines (one JSON value on
stdout, a closed list of error codes).

The Braze client underneath is a separate package that **must run unchanged in a Cloudflare
Worker, a browser or a serverless function**. That constraint shapes almost every decision here.

**Status 2026-09-13: scaffold only.** The workspace, gates, CI and documentation exist and are
verified. No Braze call has ever been made from this repository.

## 2. Layout

A single repository, one pnpm workspace, two packages. The GitHub repository is
`braze-cli`; the packages are `brazecli` and `brazecli-core`; the command is `braze`.

| Path | What | May use |
|---|---|---|
| `packages/core` | `brazecli-core` — `BrazeClient`, operations, validation, retries, pagination, batching | Web Platform APIs only |
| `packages/cli` | `brazecli` — commands, profiles, keyring, config, Pino, terminal output, run files | Node 22+ |
| `spec/` | the committed Braze API collection snapshot | — |
| `scripts/` | dev-time tooling: spec sync, catalog generation, gates | Node |
| `docs/` | everything in this table's left column, explained | — |

`cli` depends on `core`. Core never learns a CLI exists —
[`ARCHITECTURE.md`](ARCHITECTURE.md) §1.

## 3. Collecting context for a task

Take your row. Do not read the rest.

| Task | Read, in this order |
|---|---|
| **Any** | this file → [`ARCHITECTURE.md`](ARCHITECTURE.md) → [`CONVENTIONS.md`](CONVENTIONS.md) |
| What was actually asked for | [`REQUIREMENTS.md`](REQUIREMENTS.md) — the owner's brief, verbatim |
| What to build next | [`../BACKLOG.md`](../BACKLOG.md), then the plan in [`plans/`](plans/) |
| Anything in core | [`ARCHITECTURE.md`](ARCHITECTURE.md) §2–§4, `packages/core/src/errors.ts` |
| Anything that prints | [`ARCHITECTURE.md`](ARCHITECTURE.md) §5, [`TESTING.md`](TESTING.md) — the machine-output invariant |
| The API catalog | [`ARCHITECTURE.md`](ARCHITECTURE.md) §6, [`REQUIREMENTS.md`](REQUIREMENTS.md) §6–§13 |
| Why something odd is the way it is | [`DECISIONS.md`](DECISIONS.md) **before** you "fix" it |

## 4. Running it

```sh
pnpm install              # pnpm 11+, Node 22+ (24 in CI)
pnpm lint                 # biome: format + lint + the core Node ban
pnpm typecheck            # tsc --build across both packages
pnpm test                 # vitest
pnpm build
pnpm portability:core     # core bundles for a runtime with no builtins
pnpm smoke:bun            # core actually executes under bun
```

CI runs all of them on every pull request —
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## 5. Rules that cost time when broken

1. **Nothing Node-shaped enters `packages/core`.** Not `process.env`, not `Buffer`, not a config
   file, not a colour code. Everything the environment knows is passed in as an argument. Three
   separate gates enforce this and they exist because a single one is not enough
   ([`ARCHITECTURE.md`](ARCHITECTURE.md) §3).
2. **`bun build --target=browser` does not prove portability.** It rewrites `node:fs` to `{}` and
   exits 0. The gate is `esbuild --platform=neutral`; bun is the second *runtime*, not the check.
3. **In JSON mode, stdout carries data and nothing else.** No spinner, no `✓`, no warning. This is
   the contract agents depend on, and it has a test.
4. **A write is never retried automatically.** Braze documents no general idempotency key. A
   connection that died after the request left is `outcome_unknown`, never `failed`.
5. **One HTTP request carrying 75 users is 75 audit rows**, and their status is `submitted` — not
   `success`, because Braze does not acknowledge them one by one.
6. **`--confirm` is a flag, never a prompt**, for any API command. A missing one returns
   `confirmation_required`.
7. **A credential never reaches a logger**, redaction or not, and never appears as a recommended
   command line argument.
8. **Never delete things mid-task.** Append a line to [`../CLEANUP.md`](../CLEANUP.md) instead and
   do the removals in one batch at the end, after the owner confirms.
9. **Never kill a process by name.** No `pkill`, no `killall`. Find the PID, confirm it is yours,
   kill that PID.
10. **Plan before building** anything that is not a one-file change —
    [`../CLAUDE.md`](../CLAUDE.md).

## 6. What to do next

The live list is [`../BACKLOG.md`](../BACKLOG.md); the rules for taking a number are in it, under
the fold. The open thread is Phase 1, planned in
[`plans/2026-09-13-phase-1-foundation.md`](plans/2026-09-13-phase-1-foundation.md) — start at its
step 1.

Three decisions are waiting on the owner (`NEED-1`…`NEED-3`). None of them block Phase 1; each has
a recorded default in [`journal/2026-09-13-repo-setup.md`](journal/2026-09-13-repo-setup.md) §4.

## 7. Where each fact lives, and when it leaves

Every file answers **one** question. Duplicating a fact across two of them is the failure this
structure exists to prevent.

| File | Answers | The line leaves when |
|---|---|---|
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | what was asked for | never — superseded parts are marked |
| [`../BACKLOG.md`](../BACKLOG.md) | what is left to build | closed — **deleted**, one line to `BACKLOG_DONE.md` |
| [`../BACKLOG_DONE.md`](../BACKLOG_DONE.md) | where a number that vanished went | never |
| [`DECISIONS.md`](DECISIONS.md) | what the owner ruled, and why | never — overturned is struck through |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | how it is built **now** | it stopped being true — corrected in place |
| [`CONVENTIONS.md`](CONVENTIONS.md) | how code and docs are written here | — |
| [`TESTING.md`](TESTING.md) | how to check it yourself | — |
| [`plans/`](plans/) | how an **open** thread will be done | the work landed — the plan is deleted |
| [`journal/`](journal/) | the trail of a day: asked, found, decided | after a week, once harvested |
| [`../CLEANUP.md`](../CLEANUP.md) | what to remove, and why | after the removal |

**The journal is harvested before it is deleted:** an owner ruling (`NEED-nn`) goes to
[`DECISIONS.md`](DECISIONS.md) under the same number; a finding that is still true becomes a
backlog line or a paragraph in [`ARCHITECTURE.md`](ARCHITECTURE.md); the rest leaves with the file
and stays in git history.
