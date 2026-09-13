# Plan: Phase 2 — the generated API catalog

**Done means:** `braze campaign list --json` works without anyone having hand-written a
`campaign` command, `braze commands --json` lists the whole surface for an agent, and CI fails
if an endpoint silently disappears from Braze's collection.

Status: **not started.** Written 2026-09-13 against `622ef9f`, with Phase 1 closed and verified
live. Backlog items `CAT-1`…`CAT-11` plus `CORE-10` in
[`../../BACKLOG.md`](../../BACKLOG.md); brief in [`../REQUIREMENTS.md`](../REQUIREMENTS.md)
§6–§13, §49–§51, §56, §58.

---

## 1. The one thing that decides the rest

⚠ **Nobody has confirmed that Braze's collection can be exported by a script.** Every guessed
source returned 404 on 2026-09-13 (`RISK-1`). The brief hedges this itself (§8: "exact mechanics
depend on how reliably the public Postman collection can be exported").

So `CAT-1` is not a warm-up, it is the decision. Everything downstream — the normalizer, the
overrides, the coverage gate — is written against whatever shape that probe finds, and writing
any of it first risks writing it twice.

**Probe, in this order, and stop at the first that works:**

| Source | What to try | If it works |
|---|---|---|
| Postman public API | the collection's public link, then `GET https://api.getpostman.com/collections/<id>` with a token | the brief's happy path, `CAT-2` as written |
| A manual export | ask the owner to export the collection from Postman once | `spec:sync` becomes "validate and record", not "download" |
| Braze's own docs | whether `braze.com/docs/api/` exposes anything structured per endpoint | the normalizer reads that shape instead |
| Nothing structured | — | **stop and ask**; a hand-written catalog is a different project and needs the owner's decision |

Write the answer into [`../DECISIONS.md`](../DECISIONS.md) before writing code.

## 2. Order of work

Each step ends green — lint, typecheck, tests, portability — and is committable alone.

### Step 1 — the probe `CAT-1`
Above. Its output is a decision record and a fixture, not a feature.

### Step 2 — a committed snapshot `CAT-2`
`spec/braze.postman.json` plus provenance: source, timestamp, collection id, sha256. The point
(§7) is that a change on Braze's side arrives as a reviewable diff, never as a silent change in
an installed CLI.

### Step 3 — the normalizer `CAT-3`
Collection → an array of `Operation` (`packages/core/src/operation.ts:14` — the shape already
exists and Phase 1 uses it). Stable ids: Postman request id, falling back to method + normalized
path. **Never drop an endpoint silently** — an unrecognised one is an entry with a reason, not
an omission.

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
