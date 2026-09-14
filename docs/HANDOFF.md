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

**Status 2026-09-13: Phase 1 done and verified against live Braze.** `braze profile`, `braze api`
and `braze runs` work; `braze api GET /campaigns/list --json` returns real data. 152 tests.

**Not built:** the generated operation catalog. Until it exists there are no typed commands —
everything goes through `braze api`. That is Phase 2, and it is the open thread. Its one open
question is answered as of 2026-09-14: the collection downloads anonymously from Braze's own
Postman documenter (`NEED-13`), so Phase 2 starts at `CAT-2` and not at a probe.

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
| Anything in core | [`ARCHITECTURE.md`](ARCHITECTURE.md) §2–§4, `packages/core/src/client.ts` |
| A request, a retry, an error code | `packages/core/src/{client,retry,errors}.ts` |
| Anything that prints | [`ARCHITECTURE.md`](ARCHITECTURE.md) §5, [`TESTING.md`](TESTING.md) — the machine-output invariant |
| The API catalog | [`ARCHITECTURE.md`](ARCHITECTURE.md) §6, [`REQUIREMENTS.md`](REQUIREMENTS.md) §6–§13 |
| Writing a test against Braze | `packages/core/src/testing/mock-braze.ts` — never the real thing |
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

Checking whether a stored key actually works:

```sh
./scripts/check-key.sh              # the default profile
./scripts/check-key.sh staging
```

It sends the same read through our CLI and through bare `curl`. **Identical answers mean the key
or the cluster is wrong; differing answers mean we are.** Neither output can print the key —
Braze returns it inside a 401 body (`SEC-1`), so both are filtered.

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
11. **A message from Braze is data that came from outside, not text.** Braze returns the API key
    inside the body of a 401. `BrazeClient` redacts it; anything else pointed at Braze has to do
    the same ([`ARCHITECTURE.md`](ARCHITECTURE.md) §8).
12. **`braze api` consults the catalog first, then falls back to judging by HTTP method.** So the
    three POST-shaped reads (`users.export.*`) are allowed on a read-only profile, because an
    override declares them reads (`CAT-4`, `FIND-13`); every other POST is still judged by its
    method. `rawOperation` is that fallback and must keep working unchanged.
13. **Never send a non-GET request to production Braze without asking first** — not even one the
    catalog calls a read (`NEED-19`). Our classification is the thing that might be wrong, and the
    read-only profile is the last line before a real write. `--dry-run` needs no permission.

## 6. What to do next

The live list is [`../BACKLOG.md`](../BACKLOG.md); the rules for taking a number are in it, under
the fold.

**The open thread is Phase 2, the generated catalog.** Start with the handoff —
[`plans/2026-09-13-phase-2-catalog-handoff.md`](plans/2026-09-13-phase-2-catalog-handoff.md) —
and its §0, which prints the state in one command.

Nothing is waiting on the owner.

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
