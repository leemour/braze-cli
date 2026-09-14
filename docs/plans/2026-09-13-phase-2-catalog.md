# Plan: Phase 2 — the generated API catalog

**Done means:** `braze campaigns list --json` works without anyone having hand-written a
`campaigns` command (plural, per `NEED-18`), `braze commands --json` lists the whole surface for
an agent, and CI fails if an endpoint silently disappears from Braze's collection.

Status: **Steps 1–4 done (`CAT-1`…`CAT-6`); Step 5 is next, and §2 Step 5 below is the plan for
it.** Written 2026-09-13 against `622ef9f`, with Phase 1 closed and verified live; §1 answered
2026-09-14 and rewritten in place; Step 5 planned 2026-09-14 against `25bf4aa`, 228 tests green.
Backlog items `CAT-1`…`CAT-11` plus `CORE-10` in [`../../BACKLOG.md`](../../BACKLOG.md); brief in
[`../REQUIREMENTS.md`](../REQUIREMENTS.md) §6–§13, §49–§51, §56, §58.

**Correction, 2026-09-14:** this header read "`CAT-1` and `CAT-2` done; `CAT-3` is next" while
the step bodies below already recorded Steps 3 and 4 as done. The step bodies were right.

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

### Step 4 — overrides `CAT-4` ✅, coverage `CAT-5` `CORE-10` still open
Overrides done 2026-09-14 in `packages/core/src/operations/overrides.ts`, merged in
`operations/index.ts`. Seven corrections, each carrying a `reason`.

- **Keyed by `Operation.id`, not by path** as §10 sketches — a path is not unique (`/catalogs`
  has both a GET and a POST), so a path-keyed override would hit both.
- **An override may not change `id`, `method` or `path`.** Those identify the operation being
  corrected; one that could move them would quietly become an override of something else.
- **Three validations, each tested:** an override matching no operation aborts (that is how a
  renamed endpoint is caught rather than silently losing its safety classification); a write with
  `retryPolicy: "read-safe"` is rejected, which is the check `operation.ts` asks for by name; and
  `retryPolicy` is re-derived when a correction flips `access` without naming one.

**`FIND-13` is closed.** `braze api` now consults the catalog before falling back to
`rawOperation`, which is what `api.ts`'s own note meant by "corrected by a typed catalog
operation, never by guessing here". Verified live against the read-only production profile:
`POST /users/export/ids` returns 201, while `POST /users/track` and `DELETE /catalogs/...` are
still refused with `permission_error`. `rawOperation` itself is untouched.

Repeated query parameters turned out to need **no** override: no request in the collection
documents a repeated key, so there is nothing to decide per operation yet and `buildQuery` keeps
refusing rather than guessing.

**Coverage done 2026-09-14 (`CAT-5`).** `docs/catalog-coverage.md` is generated alongside the
catalog, and `pnpm catalog:check` verifies both files and now runs in CI. It reads the committed
snapshot and never the network, which is why it can gate every pull request while `spec:check`
deliberately does not.

The line that matters is **`unclassified or ambiguous`, which must stay zero**: operations Braze
implements as a write whose path reads like a query and that no override has ruled on. Proved to
be a real gate — removing the `users.export.ids` override makes the generator fail and name that
endpoint, so `FIND-13` would have been caught automatically.

`status` was dropped from the list of query-ish words after it produced three false positives in
a row (`/email/status` and both `/subscription/status/set` forms are genuine writes, per Braze's
own descriptions). A gate that cries wolf is a gate people learn to ignore.

Still open: Valibot schemas and validation levels — `CORE-10`. **Correction, 2026-09-14:** this
line also named `CAT-10`, which is a different task (smoke tests generated from the collection's
own examples). `FIND-18` traces where the confusion came from.

### Step 5 — commands from the catalog `CAT-6` ✅ `CAT-9` `CAT-7` `CAT-11`

`CAT-6` landed 2026-09-14: 95 operations registered in a loop by
`packages/cli/src/commands/catalog.ts:12`, and `braze staging campaigns list --json` returns the
same bytes as the raw call. What is left is the half that makes the catalog *usable by an agent*
rather than merely callable: the invariants pinned (`CAT-9`), the contract of one operation
readable (`CAT-7`), and paging that terminates (`CAT-11`).

**Done means:** every one of the 95 operations is covered by a test that would fail if the
generator regressed; `braze schema campaigns list` prints what an agent needs to build the call,
saying where each part came from; and `braze <paged command> --paginate` walks pages under a
bound it cannot exceed.

#### The order, and why it is not the backlog's

**`CAT-9` first, then `CAT-7`, then `CAT-11`.** `BACKLOG.md` says "then `CAT-7`", so this is a
deliberate reversal, not a slip:

- `CAT-9` is an extension of an already-green file
  (`packages/core/src/operations/catalog.test.ts:1`, 9 tests today) and needs no new production
  code. It is the cheapest item in the step.
- `CAT-7` *exposes* the very fields `CAT-9` pins. Publishing `pathParameters` through
  `braze schema` before anything asserts it matches the placeholders in `path` is the wrong way
  round — the test is what makes the published contract true.
- `CAT-11` needs `FIND-19` fixed first (three paged endpoints are not classified as paged), and
  that fix is easiest to verify once `CAT-9` has a gate for it.

#### `CAT-9` — a contract test over every operation, not a chosen few

**What a "contract test" means here**, since the handoff left it open: a table-driven test in
**core**, over all 95 catalog entries, asserting properties directly against
`packages/core/src/request.ts`. Plus one in the CLI that builds a Commander command per operation.

**Rejected: running each operation through `--dry-run`**, which the handoff suggested. `--dry-run`
goes through `runOperation` (`packages/cli/src/execute.ts:31`), which resolves settings, demands a
profile, opens a run directory and writes `run.json` and `events.jsonl` to disk. Ninety-five of
those is slow, and what it would actually exercise is the run machinery, not the catalog. The
property worth checking — "a request is constructible from this operation" — is `buildUrl`'s, and
it is checked where it lives.

Properties, each over all 95:

| # | Property | Why it is worth a test |
|---|---|---|
| 1 | `id` unique, and matches `^[a-z0-9][a-z0-9.-]*$` | `id` is promised stable and is an override key; a stray character makes an override silently unmatchable |
| 2 | `method` is one of the six `HttpMethod` values | the generator reads it from Postman, which is free text |
| 3 | `path` starts with `/`, contains no `{{` and no whitespace | `resolvePath` throws on the first; the other two mean a Postman placeholder leaked |
| 4 | `access` is `read` or `write`, and a `write` is never `read-safe` | already enforced on override merge; this pins it for the generated ones too |
| 5 | `command` unique as a whole, non-empty, every word `^[a-z0-9][a-z0-9-]*$` | a word Commander cannot register takes the command out silently |
| 6 | `pathParameters` equals the placeholders in `path`, **in order** | this is the only thing an agent is told in order to call the operation at all |
| 7 | `resolvePath(path, {each: "x"})` returns a path with no `{` left | proves 6 is not merely consistent but sufficient |
| 8 | `buildUrl` with a dummy endpoint yields a parseable URL | the "constructible request" the backlog line asks for |
| 9 | `queryParameters` names unique per operation, no `{{` in any example | `BUG-4`'s neighbourhood; a duplicate name makes one of them unreachable as a flag |
| 10 | no `command` is a strict prefix of another | **the one that matters most** — a name that is both a leaf and a group takes down the *whole* program, not one command (handoff §4) |
| 11 | no first word collides with a handwritten top-level command | same failure as 10, across the `catalog.ts` / `program.ts` seam. Measured today: 21 distinct first words, none of them `api`, `profile`, `runs`, `commands` or `schema` |

Properties 10 and 11 are checked in the generator already; the test exists so that weakening the
generator is visible rather than merely regrettable.

#### `CAT-7` — `braze schema`, the contract of one operation

**How an operation is named.** `braze schema <words...>`, variadic, accepting **either** form:

```sh
braze schema campaigns list          # command words, via findByCommand
braze schema campaigns.list.get      # operation id, via findOperation
```

Both, because the two discovery surfaces speak different languages: an agent reading
`braze commands --json` has command words, while `docs/catalog-coverage.md` and `overrides.ts`
are keyed by id. Resolving id first and falling back to words costs one lookup and removes a
whole class of "I have the wrong kind of name" failure. An unresolvable name is a
`validation_error` that lists the nearest few commands.

**`commands --json` gains `operationId` per leaf.** Today `describe()` in
`packages/cli/src/commands/commands.ts:110` emits `path, name, description, usage, arguments,
options, commands` and no id — so an agent reading the discovery surface has no way to reach an
id at all, and half of `braze schema`'s addressing is unreachable in practice. The catalog
commands get a marker when they are built in `catalog.ts`, and `describe()` passes it through.

**No profile, and a test that says so.** `schema` talks to Braze not at all, so it joins
`profile`, `runs` and `commands` in `NEED-25`'s no-profile set. Worth an explicit test because
the handoff's §4 warns that a test which "just calls a command" now fails with
`configuration_error`.

**What it prints** — the operation, plus the part Postman does carry and nothing here yet uses:

```json
{
  "id": "users.track.create",
  "command": ["users", "track"],
  "method": "POST", "path": "/users/track",
  "access": "write", "retryPolicy": "never",
  "permission": "users.track",
  "batch": { "attributes": 75, "events": 75, "purchases": 75 },
  "pathParameters": [], "queryParameters": [],
  "requestBody": { "source": "example", "example": { "attributes": [ … ] } },
  "confirmationRequired": true,
  "documentationUrl": "https://www.braze.com/docs/api/endpoints/…"
}
```

**Where the request body comes from — `FIND-17` settles it, and it is not where the handoff
guessed.** The handoff's §6 said the body schema should be handwritten next to the override,
"because Postman does not give it". Measured against the committed snapshot, Postman gives 32 of
them outright:

- **48 of the 99 requests carry a non-empty raw body** (43 POST, 4 PUT, 1 PATCH; no GET or
  DELETE has one).
- **32 parse as strict JSON and contain no `{{…}}` placeholder** — real, usable examples,
  9 652 bytes compact for all 32.
- **16 are not JSON.** Braze writes documentation into the value position:
  `"name": (required, string) Must be less than 100 characters,`. 8 231 bytes for all 16.

So the generator derives `requestBody` in two flavours, and the flavour travels with the data:

```ts
export interface RequestBodyDoc {
  /** `example` — real JSON from the collection. `annotated` — Braze's prose, not machine-readable. */
  source: "example" | "annotated"
  example?: unknown
  text?: string
}
```

**Rejected: a tolerant parser for the annotated 16.** The regular shape
`"key": (required|optional[, type]) description` matches only **55 of the 145** quoted-key lines
in those bodies — 38%. A parser that handles 38% and silently mishandles the rest is `BUG-4`
again, and §3 below names the failure by its own name. The 16 travel as verbatim text, labelled
`annotated`, and `braze schema` prints them with a line saying they are Braze's prose rather than
a schema.

**Neither flavour is validation.** `requestBody.example` is an example; `strict`/`generated`/
`passthrough` remain `CORE-10`'s decision, and nothing in this step may start rejecting a request
because it does not match an example. That is the mistake §3 exists to prevent.

Cost to the portability gate: ~17.9 KB of data added to `generated.ts` (1 104 lines today), no
new import. `pnpm portability:core` and `pnpm smoke:bun` are run as part of the step, not after it.

#### `CAT-11` — pagination that terminates

**First, `FIND-19`: three paged endpoints are not classified as paged.** Six operations carry a
`page` query parameter; only the three with a handwritten override declare `pagination: "page"`.
`events.list.get`, `feed.list.get` and `purchases.product-list.get` do not, so `paginationNote`
(`packages/cli/src/execute.ts:96`) stays silent on them today and `--paginate` would silently do
nothing on half the paged surface.

Three pieces, in order:

1. **Classify the three**, as overrides with a `reason`. Their page size is *not* assumed to be
   100 — Braze documents each in prose and the existing three each needed checking. An operation
   whose page size cannot be established gets `pagination: "page"` and no `pageSize`, which is
   honest: `paginationNote` degrades to "page N, 40 rows" without the "so there is probably more"
   claim it cannot support.
2. **A gate, so this cannot recur.** `catalog:check` already fails on an unclassified *access*
   (`CAT-5`); it gains the same for pagination — an operation with a `page` query parameter and
   no `pagination` fails the build and is named. This is the half of `FIND-19` that matters:
   the three endpoints are a bug, the missing gate is why nobody saw it.
3. **The flags:** `--paginate`, `--max-pages <n>`, `--max-items <n>`, refused on an operation
   that declares no pagination rather than ignored. **Always bounded** — `--paginate` with
   neither bound gets a default ceiling, not an unbounded walk, because an agent that mistypes a
   filter should not discover it by making 900 requests to production. Pages are emitted as one
   JSON value on stdout (rule 3), so the walk accumulates and prints once.

`offset` and `cursor` stay unimplemented: no operation in the collection declares either, and
building for a shape nothing uses is how it ends up wrong.

#### Test plan

| What | Where | Kind |
|---|---|---|
| the 11 properties, over all 95 | `packages/core/src/operations/catalog.test.ts` | table-driven, no network |
| a Commander command builds for all 95, and the tree has no prefix collision | `packages/cli/src/commands/catalog.test.ts` | builds the real tree |
| `requestBody` derived: 32 `example`, 16 `annotated`, counts pinned | `packages/core/src/operations/catalog.test.ts` | against the real catalog, never a fixture (`BUG-4`) |
| `braze schema` resolves by id **and** by command words | `packages/cli/src/commands/schema.test.ts` | new file |
| `braze schema` needs no profile | same | explicit, per handoff §4 |
| `braze schema` on an unknown name is a `validation_error` listing near matches | same | |
| `commands --json` carries `operationId` on every catalog leaf and on no handwritten one | `packages/cli/src/commands/commands.test.ts` | |
| `--paginate` stops at `--max-pages`, and at a default ceiling with no bound given | `packages/cli/src/execute.test.ts` | mock fetch, counts requests |
| `--paginate` on an unpaginated operation is refused, not ignored | same | |
| `catalog:check` fails on a `page` parameter with no `pagination` | `tests/` gate test | proved by removing one override, as `CAT-5` was |

Gates for the step: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then
`pnpm catalog:check && pnpm portability:core && pnpm smoke:bun`.

#### Open questions

- **`--paginate`'s default ceiling, when neither bound is given.** A number has to be picked.
  Proposed: 10 pages, which is 1 000 rows at the documented page size — enough to be useful,
  small enough that a mistake is cheap. Named here because it is a product decision, not a
  technical one.
- **Whether `braze schema` should also accept a bare path** (`braze schema /campaigns/list`).
  Cheap to add via `findByRequest`, but it needs a method to disambiguate `/catalogs`, which has
  both a GET and a POST. Left out unless asked.

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
