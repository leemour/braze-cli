# Backlog

Everything not yet built, one line per item. A closed item is **deleted** from here — the trail
stays in [`BACKLOG_DONE.md`](BACKLOG_DONE.md) and in git history.

The brief this is cut from: [`docs/REQUIREMENTS.md`](REQUIREMENTS.md). The plan for the
current phase: `docs_ai/plans/` (local only, not committed).

<details>
<summary>Rules of this file — read once</summary>

- **A number is a permanent address.** Commits, code comments and plans cite it. A number is never
  reused. Take the next one like this, not by eye:
  ```sh
  git pull --ff-only
  grep -ohE '<PREFIX>-[0-9]+' docs/BACKLOG.md docs/BACKLOG_DONE.md | sort -V | tail -1
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
  `DEBT`) and are allocated by `docs_ai/journal/next-id.sh` (local only). A finding
  that turns into work gets a backlog number too, and the journal entry keeps a pointer.
- **The title is the task, not the symptom.** "Give ambiguous writes their own outcome", not
  "ambiguous writes look like failures".
- **One line, with an anchor in it.** `packages/core/src/retry.ts:42` is worth more than a
  paragraph — it points at where the work starts. Analysis goes elsewhere: a durable truth about
  an area into [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), an owner's ruling into
  [`DECISIONS.md`](DECISIONS.md), a deletion into `docs_ai/CLEANUP.md` (local only), a plan
  into `docs_ai/plans/` (local only, not committed).
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

**Open thread:** Phase 2, the generated catalog. `CAT-1`…`CAT-6` are done — the collection is
committed, 95 operations are generated from it, and every one is registered as a command.
**Phase 2 is functionally complete** (2026-09-14). `CAT-1`…`CAT-9`, `CAT-11` and `CAT-13` are all
closed: 95 operations generated from Braze's own collection and registered as typed commands,
contract-tested, every flag described, `braze schema` answering for one, `--paginate` bounded, and
[`docs/commands.md`](commands.md) generated from the CLI with a CI gate. 362 tests.

**`CORE-10` closed 2026-09-14**: `validateRequest` refuses what cannot work before it costs an
HTTP call, at three levels — 2 strict, 79 generated, 14 passthrough. 381 tests. It found `BUG-8`,
a wrong batch limit that would have made the Phase 3 pipeline send three times Braze's allowance.

**Phase 3 is complete, 2026-09-15.** All seven steps of
its plan are closed: the pipeline sends a file of records
to Braze in bounded memory — measured at 599 records resident on a million-record run — leaves one
truthful audit row each, and survives Ctrl+C without truncating the audit or lying about what
reached Braze. Verified end to end against a staging workspace. `RISK-3` is closed: Braze does
attribute an error inside a 2xx, by `index` and `input_array`.

**What is left of it:** `BULK-10` (`braze runs cleanup`) and `BULK-13` (JSON-array input), both P3
and blocking nothing.

`CAT-10` at P3 blocks nothing.

## Blocked on the owner

**Nothing.** `NEED-30`, `NEED-31` and `NEED-32` were all answered on 2026-09-15 and are rulings in
[`DECISIONS.md`](DECISIONS.md): bulk is a `--records` flag on the existing command, not a
second command tree; and every record carries an identifier of ours, with required fields checked
before the request rather than after Braze refuses it.

Previously: `NEED-1`, `NEED-2` and `NEED-3` were all answered on 2026-09-13 and are rulings in
[`DECISIONS.md`](DECISIONS.md): a terminal gets the pretty renderer and a pipe gets JSON;
the published package is `brazecli` (`NEED-2`, and `NEED-47` for why it is one package rather than
two); run artifacts never expire on a timer.

---

## Phase 1 — foundation

Everything needed for one hand-written command to reach Braze safely. Closed and verified live on
2026-09-13; its plan was removed on 2026-09-14 once the owner confirmed, so the rulings are in
[`DECISIONS.md`](DECISIONS.md) and the leftovers are the rows below.

### Core — the portable client

| Number | Task | P |
|---|---|---|
| `CORE-11` | 🟡 **Corrected 2026-09-17: this said the CLI still has to build the user agent, and it has been building it since Phase 1** — `packages/cli/src/execute.ts` and `commands/verify.ts`. What is actually left is smaller and real: the same string is written out twice, and both hardcode `runtime/node` even under bun, which `pnpm smoke:bun` makes a supported runtime. One helper, and the runtime read from `process.versions` | P3 |

### CLI — the Node side

| Number | Task | P |
|---|---|---|
| `CLI-12` | 🟡 The mapping exists in `packages/cli/src/exit-codes.ts` and `run` applies it; every new command has to route its failures through a `BrazeError` for it to hold | P2 |

## Left over from Phase 1

| Number | Task | P |
|---|---|---|

## Phase 2 — the generated API catalog

| Number | Task | P |
|---|---|---|
| `CAT-1` | ✅ Done 2026-09-14. The source is Braze's own Postman documenter, fetched anonymously — `NEED-13` in [`DECISIONS.md`](DECISIONS.md) | P1 |
| `CAT-2` | ✅ Done 2026-09-14. `pnpm spec:sync` writes `spec/braze.postman.json` (99 requests) and `spec/provenance.json`; refuses anything that is not a collection, and writes nothing when nothing changed | P1 |
| `CAT-3` | ✅ Done 2026-09-14. `pnpm catalog:generate` → `packages/core/src/operations/generated.ts`, 95 operations from 99 requests; ids are deterministic and collisions fail the build | P1 |
| `CAT-4` | ✅ Done 2026-09-14. `operations/overrides.ts` keyed by operation id, merged with validation; `FIND-13` fixed and verified live. Valibot schemas and PII fields still to come with `CORE-10` — corrected 2026-09-14, this said `CAT-10`, which is the smoke tests two rows down (`FIND-18`) | P1 |
| `CAT-5` | ✅ Done 2026-09-14. `docs/catalog-coverage.md` is generated with the catalog; `pnpm catalog:check` runs in CI and fails on a stale catalog or an unclassified endpoint | P1 |
| `CAT-6` | ✅ Done 2026-09-14. 95 operations registered in a loop; `braze campaigns list --json` returns the same bytes as the raw call | P1 |
| `CAT-10` | Every operation with a documented request body builds a request from it — driven by the collection's 48 body examples, 32 of them real JSON (`FIND-17`). Reworded 2026-09-14 per `NEED-28`: it said "smoke tests generated from the collection's own examples", and the collection has 0 response examples across all 99 requests (`FIND-20`) | P3 |

## Phase 3 — bulk and audit

Expected to ship with the first practically useful release, not after it.

| Number | Task | P |
|---|---|---|
| `BULK-13` | Bulk input as one big JSON array. Deferred 2026-09-15 with `BULK-2`: streaming it needs a hand-rolled incremental scanner — depth, strings, escapes — that we would then own, and §37 already tells callers to prefer JSONL at this scale. JSONL and CSV cover every stated use. Worth building only if somebody turns up with an array they cannot convert | P3 |
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
| `OPS-3` | Shell completions for bash/zsh/fish, generated from the catalog | P3 |
| `SEC-2` | Sweep every other place a third-party string reaches a stream — Braze's message is data from outside, and `SEC-1` proved it can carry the key | P2 |
| `OPS-4` | `test:live` harness — read-only by default, a dedicated profile, never run in CI | P2 |
| `OPS-6` | A second published version through the release workflow rather than by hand — the tag path in [`.github/workflows/release.yml`](../.github/workflows/release.yml) has never run, and it needs `NPM_TOKEN` in the repository secrets or npm trusted publishing configured | P2 |
| `DOC-3` | `docs/development.md` — how to work on brazecli itself, split out of the README's Development section once there is a second contributor | P3 |
