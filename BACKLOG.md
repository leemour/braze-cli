# Backlog

Everything not yet built, one line per item. A closed item is **deleted** from here — the trail
stays in [`BACKLOG_DONE.md`](BACKLOG_DONE.md) and in git history.

The brief this is cut from: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md). The plan for the
current phase: [`docs/plans/`](docs/plans/).

<details>
<summary>Rules of this file — read once</summary>

- **A number is a permanent address.** Commits, code comments and plans cite it. A number is never
  reused. Take the next one like this, not by eye:
  ```sh
  git pull --ff-only
  grep -ohE '<PREFIX>-[0-9]+' BACKLOG.md BACKLOG_DONE.md | sort -V | tail -1
  ```
- **Prefixes, and nothing invented:**

  | | |
  |---|---|
  | `OPS` | repository, tooling, CI, release |
  | `CORE` | `packages/core` — the portable client |
  | `CLI` | `packages/cli` — everything Node-specific |
  | `CAT` | spec sync, catalog generation, overrides, coverage, generated docs |
  | `BULK` | bulk pipeline, run artifacts, audit CSV |
  | `DOC` | handwritten documentation |

  Findings carry the journal's own prefixes (`FIND`, `BUG`, `SEC`, `PERF`, `UX`, `IDEA`, `RISK`,
  `DEBT`) and are allocated by [`docs/journal/next-id.sh`](docs/journal/next-id.sh). A finding
  that turns into work gets a backlog number too, and the journal entry keeps a pointer.
- **The title is the task, not the symptom.** "Give ambiguous writes their own outcome", not
  "ambiguous writes look like failures".
- **One line, with an anchor in it.** `packages/core/src/retry.ts:42` is worth more than a
  paragraph — it points at where the work starts. Analysis goes elsewhere: a durable truth about
  an area into [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), an owner's ruling into
  [`docs/DECISIONS.md`](docs/DECISIONS.md), a deletion into [`CLEANUP.md`](CLEANUP.md), a plan
  into [`docs/plans/`](docs/plans/).
- **Priority.** **P1** blocks other work or breaks something real · **P2** needed this cycle ·
  **P3** someday. Rank honestly; a backlog where everything is P1 says nothing.
- **Mark.** Empty — not started · 🟡 half done, the remainder named in the line · ⏸️ deferred by
  the owner · 🚩 waiting on an owner decision, not on code.
- **An item owned by a plan stands here as one link.** Two answers to "is it done" is exactly the
  failure the rest of this is built to avoid.
- **The line lies more often than you would think.** Before fixing, check:
  `git log -S'<string>' -- <path>`.

</details>

---

## In progress

> **Phase 1 is closed and verified against live Braze** (2026-09-13). `braze api GET
> /campaigns/list --json` returns real data with exit code 0; a write is refused without
> `--confirm` and refused outright on a read-only profile; each run leaves `run.json` and a
> populated `events.jsonl`. 152 tests.
>
> Three defects came out of the live runs and are fixed: `SEC-1` (Braze echoes the API key inside
> its 401 message), `BUG-1` (the audit log was empty by default) and `FIND-13` (`/users/export/ids`
> is a read Braze implements as a POST — correct behaviour today, and the first concrete case for
> `CAT-4`).

**Open thread:** Phase 2, the generated catalog —
[`docs/plans/2026-09-13-phase-2-catalog.md`](docs/plans/2026-09-13-phase-2-catalog.md). `CAT-1` is
answered (`NEED-13`): the collection downloads anonymously from Braze's Postman documenter, 99
requests, every one with a distinct Postman id. **Start at `CAT-2`**, the committed snapshot.

## Blocked on the owner

**Nothing.** `NEED-1`, `NEED-2` and `NEED-3` were all answered on 2026-09-13 and are rulings in
[`docs/DECISIONS.md`](docs/DECISIONS.md): a terminal gets the pretty renderer and a pipe gets JSON;
the packages are `brazecli` and `brazecli-core`, published no earlier than v1; run artifacts never
expire on a timer.

---

## Phase 1 — foundation

Everything needed for one hand-written command to reach Braze safely. Plan:
[`docs/plans/2026-09-13-phase-1-foundation.md`](docs/plans/2026-09-13-phase-1-foundation.md).

### Core — the portable client

| Number | Task | P |
|---|---|---|
| `CORE-10` | Valibot validation with the three levels — `strict`, `generated`, `passthrough` | P2 |
| `CORE-11` | 🟡 The `userAgent` option exists and core invents no default; the CLI still has to build `brazecli/<version> runtime/<runtime> platform/<platform>` | P3 |

### CLI — the Node side

| Number | Task | P |
|---|---|---|
| `CLI-12` | 🟡 The mapping exists in `packages/cli/src/exit-codes.ts` and `run` applies it; every new command has to route its failures through a `BrazeError` for it to hold | P2 |
| `CLI-13` | `SIGINT`/`SIGTERM` handling: stop scheduling, flush, finalize, exit — the scaffolding bulk needs later | P2 |

## Left over from Phase 1

| Number | Task | P |
|---|---|---|
| `CORE-10` | Valibot validation with the three levels — `strict`, `generated`, `passthrough`. Nothing to validate against until the catalog exists, so it moves next to `CAT-4` | P2 |
| `CLI-13` | `SIGINT`/`SIGTERM` handling: stop scheduling, flush, finalize, exit. `run.finish` is already idempotent and called on every path, so this is wiring a handler to it | P2 |
| `CLI-15` | 🟡 `braze profile add` cannot take the key on stdin — only `BRAZE_API_KEY` or a terminal prompt. A CI that has neither is stuck | P3 |

## Phase 2 — the generated API catalog

| Number | Task | P |
|---|---|---|
| `CAT-1` | ✅ Done 2026-09-14. The source is Braze's own Postman documenter, fetched anonymously — `NEED-13` in [`docs/DECISIONS.md`](docs/DECISIONS.md) | P1 |
| `CAT-2` | ✅ Done 2026-09-14. `pnpm spec:sync` writes `spec/braze.postman.json` (99 requests) and `spec/provenance.json`; refuses anything that is not a collection, and writes nothing when nothing changed | P1 |
| `CAT-3` | ✅ Done 2026-09-14. `pnpm catalog:generate` → `packages/core/src/operations/generated.ts`, 95 operations from 99 requests; ids are deterministic and collisions fail the build | P1 |
| `CAT-4` | ✅ Done 2026-09-14. `operations/overrides.ts` keyed by operation id, merged with validation; `FIND-13` fixed and verified live. Valibot schemas and PII fields still to come with `CAT-10` | P1 |
| `CAT-5` | ✅ Done 2026-09-14. `docs/catalog-coverage.md` is generated with the catalog; `pnpm catalog:check` runs in CI and fails on a stale catalog or an unclassified endpoint | P1 |
| `CAT-6` | ✅ Done 2026-09-14. 95 operations registered in a loop; `braze campaigns list --json` returns the same bytes as the raw call | P1 |
| `CAT-7` | ◐ `braze commands --json` done 2026-09-14, ahead of the catalog: it walks the live Commander tree, so catalog commands join it automatically. `braze schema <operation>` still needs the catalog | P1 |
| `CAT-8` | `docs:generate` and `docs:check` producing `docs/commands.md` and `docs/catalog-coverage.md` from the same catalog | P2 |
| `CAT-9` | Contract tests over **every** generated operation: unique id, valid method and path, unique command, known access, resolvable path variables, constructible request | P1 |
| `CAT-10` | Smoke tests generated from the collection's own examples — broad coverage, not a substitute for hand-written tests on important endpoints | P3 |
| `CAT-11` | Pagination: `none`/`page`/`offset`/`cursor` metadata plus `--paginate`, `--max-pages`, `--max-items`, always bounded | P2 |

## Phase 3 — bulk and audit

Expected to ship with the first practically useful release, not after it.

| Number | Task | P |
|---|---|---|
| `BULK-1` | Bulk executor built on `AsyncIterable<Record>`, so the source can be a file, a database or another program without touching the pipeline | P1 |
| `BULK-2` | Streaming parsers for JSONL, CSV and JSON, none of which may materialize the whole input | P1 |
| `BULK-3` | Batch to Braze's per-endpoint limits **before** concurrency — 750 000 users → 75 per request → 10 000 batches → 4 in flight | P1 |
| `BULK-4` | `p-queue` with bounded depth and real backpressure; the parser must never enqueue two million promises | P1 |
| `BULK-5` | `records.csv` streamed as work completes, one row per logical record even when 75 shared one HTTP request | P1 |
| `BULK-6` | Truthful per-record status: `planned`/`submitted`/`failed`/`unknown`/`invalid`/`skipped` — never `success` without a per-record acknowledgement from Braze | P1 |
| `BULK-7` | Progress UI: records/sec, batches/sec, elapsed, rough ETA — pretty mode only, never in a log or on stdout in JSON mode | P2 |
| `BULK-8` | Ctrl+C mid-run flushes the audit CSV and finalizes `run.json` without corrupting a row | P1 |
| `BULK-9` | A synthetic million-record run proving memory stays bounded, without making a million HTTP calls | P2 |
| `BULK-10` | `braze runs cleanup` with an explicit retention setting — opt-in, never a default (`NEED-3`) | P3 |

## Phase 4 — when real usage asks for it

| Number | Task | P |
|---|---|---|
| `BULK-11` | `braze run resume <run-id>` — the run format must already make "submitted / failed / unknown / not started" answerable per source record | P3 |
| `CAT-12` | Scheduled drift check against the live Braze collection, opening a PR rather than changing behaviour silently | P3 |
| `CORE-13` | Adaptive rate limiting driven by observed headers rather than a fixed concurrency | P3 |
| `CORE-14` | MCP tool definitions generated from the same catalog as the commands and the docs | P3 |
| `OPS-5` | A Cloudflare Worker consumer package, which is also the strongest possible portability test | P3 |

## Tooling, release and documentation

| Number | Task | P |
|---|---|---|
| `OPS-2` | Release `brazecli` and `brazecli-core` at v1: changelog, versioning, and confirming npm accepts a name one hyphen from `braze-cli` (`NEED-2`) | P3 |
| `OPS-3` | Shell completions for bash/zsh/fish, generated from the catalog | P3 |
| `SEC-2` | Sweep every other place a third-party string reaches a stream — Braze's message is data from outside, and `SEC-1` proved it can carry the key | P2 |
| `OPS-4` | `test:live` harness — read-only by default, a dedicated profile, never run in CI | P2 |
| `DOC-1` | Rewrite `README.md` as a real quick start once a command exists that can be run | P2 |
| `DOC-2` | `docs/authentication.md`, `docs/configuration.md`, `docs/bulk-runs.md`, `docs/security.md`, `docs/development.md` — each written when the thing it describes exists, not before | P2 |
