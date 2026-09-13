# Plan: Phase 2 — the generated API catalog

**Done means:** `braze campaigns list --json` works without anyone having hand-written a
`campaigns` command (plural, per `NEED-18`), `braze commands --json` lists the whole surface for
an agent, and CI fails if an endpoint silently disappears from Braze's collection.

Status: **`CAT-1` and `CAT-2` done; `CAT-3` is next.** Written 2026-09-13 against `622ef9f`, with Phase 1
closed and verified live; §1 answered 2026-09-14 and rewritten in place. Backlog items
`CAT-1`…`CAT-11` plus `CORE-10` in [`../../BACKLOG.md`](../../BACKLOG.md); brief in
[`../REQUIREMENTS.md`](../REQUIREMENTS.md) §6–§13, §49–§51, §56, §58.

---

## 1. The one thing that decides the rest — ✅ answered 2026-09-14

**`CAT-1` is done, and the happy path won.** The collection downloads anonymously from Braze's own
Postman documenter:

```text
https://documenter.getpostman.com/api/collections/4689407/SVYrsdsG
```

`200`, 565 438 bytes of collection JSON, no token. Recorded as `NEED-13` in
[`../DECISIONS.md`](../DECISIONS.md) with the measurements; `RISK-1` is corrected in place in its
journal. **No fallback branch is needed — `spec:sync` downloads.**

What the rest of the phase now inherits, measured rather than assumed:

- **99 requests, 32 folders**, covering everything confirmed live under `NEED-11` plus
  `/users/export/ids`.
- **All 99 Postman ids are distinct**, so §9's preferred identity holds — but only 95 of the
  `METHOD + path` pairs are, because the four Subscription Groups endpoints appear twice, once
  under Email and once under SMS and WhatsApp (`FIND-15`). The fallback identity must not be the
  primary one, and `CAT-3` owes a test that catches an id collision instead of dropping the
  operation.
- **Three downloads produced one sha256**, so a diff in `spec/` is signal, not churn.
- **The address is Postman's internal API** and may move without notice (`RISK-2`). Runtime does
  not care — the committed snapshot ships — but `spec:sync` must verify it received a collection
  before it overwrites anything.

> The probe ran the plan's original table in order. `https://api.getpostman.com/collections/<uid>`
> returned `401` (it wants a token), the documenter route returned the collection, and rows three
> and four were never reached. The community package
> [`braze-community/braze-specification`][braze-spec] republishes the same collection and stays on
> the shelf as a fallback, unaffiliated with Braze.

[braze-spec]: https://github.com/braze-community/braze-specification

## 2. Order of work

Each step ends green — lint, typecheck, tests, portability — and is committable alone.

### Step 1 — the probe `CAT-1` ✅
Done — §1 above. Its output was a decision record (`NEED-13`), not a feature. Nothing was committed
into `spec/`; that is Step 2's job.

### Step 2 — a committed snapshot `CAT-2` ✅
Done 2026-09-14. `pnpm spec:sync` (`scripts/sync-spec.mjs`) writes `spec/braze.postman.json` —
99 requests, reformatted so the diff is readable — and `spec/provenance.json` beside it.

Three decisions taken while building it:
- **Two hashes, not one.** `sourceSha256` is of the bytes as received and is what detects an
  upstream change; `sha256` is of the formatted file, so the committed artifact verifies alone.
- **An unchanged sync writes nothing**, `syncedAt` included, so a diff here always means Braze
  moved. A timestamp rewritten on every run would have made the diff worthless, which is the
  thing §7 is asking for.
- **`--from <export.json>`** validates a manual export instead of fetching. That is the plan's
  row-2 fallback for `RISK-2`, and it is also the seam the tests use, so no test touches the
  network.

`spec:check` deliberately does **not** gate pull requests: it reaches the network, and CI that
depends on Postman's uptime buys flakiness, not safety.

### Step 3 — the normalizer `CAT-3` ✅
Done 2026-09-14. `pnpm catalog:generate` (`scripts/generate-catalog.mjs`) turns the snapshot into
`packages/core/src/operations/generated.ts`: **99 requests → 95 operations**, 42 read and 53 write.
Read it through `catalog` from `packages/core/src/operations/index.js`, never the generated file —
that is where `CAT-4` merges overrides on top.

Four decisions, and the reasoning that picked each:

- **The id is `path.with.by-id.markers.verb`, always** — `campaigns.list.get`,
  `catalogs.by-id.items.by-id.get`. Four schemes were measured over the real 99 requests and this
  is the only one with no collision between two different endpoints. A prettier "shortest unique
  id" scheme was rejected outright: `Operation.id` is promised stable across regenerations, and
  shortest-unique silently **renames** `users.track` the day Braze adds a second method on that
  path.
- **The command escalates in three tiers** — bare path, then a verb, then the marked path — each
  used only when the tier before it collides. The third tier is the id's own shape, so it is unique
  by construction and the escalation terminates. 21 of the 95 needed a tier above the first, and
  `command` carries no stability promise because §10 makes names an override's job.
- **No singularisation.** `braze campaign list` in the brief and `["users", "track"]` in its own
  override example disagree, and naive plural-stripping turns `canvas` into `canva`. Paths go
  through as they are, and singular aliases are overrides, one at a time.
- **The generator is plain JS; its output is the typed thing.** `tsc` checks
  `generated.ts` when it builds core, so a generator bug that produces a bad field fails the build
  rather than a test nobody wrote.

**Nothing is dropped in silence.** The four endpoints Braze documents twice (`FIND-15`) merge into
one operation each and are named in the run's output; two *different* endpoints deriving one id
aborts the generator with both paths printed.

`/users/export/ids` is still generated as a write, because access comes from the HTTP method here
(`FIND-13`). A test pins that, so `CAT-4` flipping it will be visible rather than silent.

### Step 4 — overrides and coverage `CAT-4` `CAT-5` `CORE-10`
Handwritten corrections merged over the generated catalog. The first three, already known:

- **`/users/export/ids` is `access: "read"`** despite being a POST (`FIND-13`). This is the case
  that motivated overrides existing.
- Repeated query parameters: decide per operation whether Braze wants them repeated or joined.
  `buildQuery` refuses arrays today and names `CAT-3` in the message.
- Batch limits for `/users/track` — 75 per field, which Phase 3 needs.

`catalog:check` then fails CI when an operation vanishes or arrives unclassified.

### Step 5 — commands from the catalog `CAT-6` `CAT-7` `CAT-9` `CAT-11`
Register Commander commands in a loop, not by hand. `braze commands --json` and
`braze schema <id>` are the agent's discovery surface. Contract tests run over **every**
generated operation rather than a chosen few.

### Step 6 — generated documentation `CAT-8`
`docs/commands.md` and `docs/catalog-coverage.md` from the same catalog, with `docs:check`
failing CI when they go stale.

## 3. What will bite

- **The catalog lives in core, the commands live in the CLI.** A generated operation is data;
  turning it into a Commander command is the CLI's job. Core must not learn what Commander is.
- **`rawOperation` stays.** `braze api` is the escape hatch for everything the catalog misses
  and must keep working unchanged.
- **A generated operation is not a validated one.** §11's three levels — `strict`, `generated`,
  `passthrough` — exist because Postman examples are not schemas. Marking everything `strict`
  because a schema was inferrable is how a wrong schema starts refusing valid requests.
- **The coverage report is a gate, not a report.** §12: CI fails on an unclassified endpoint.
  A number nobody blocks on is a number nobody reads.

## 4. Out of scope

The bulk pipeline and `records.csv` (Phase 3), checkpoint/resume and MCP generation (Phase 4),
shell completions, publishing.
