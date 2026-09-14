# Plan: `CORE-10` — Valibot validation, and the three levels

**Done means:** a request that cannot succeed is refused **before it costs an HTTP call**, with a
message naming the field; a request the catalog merely does not understand still goes through; and
no valid request is ever refused because Braze's Postman example was incomplete.

Written 2026-09-14 against `c89a95f`, with Phase 2 complete and 362 tests green.
Backlog item `CORE-10` in [`../../BACKLOG.md`](../../BACKLOG.md); brief in
[`../REQUIREMENTS.md`](../REQUIREMENTS.md) §11, with §550 (dry run validates) and §12 (the
coverage report counts the levels).

---

## 1. The thing that decides the rest

**A wrong schema is worse than no schema.** The phase plan said it about the catalog and it is
truer here: an operation marked `strict` on a guess starts refusing requests Braze would have
accepted, and the person hitting it has no way to overrule us except `braze api`. Every decision
below falls out of that.

So: **nothing is `strict` unless a human wrote its schema by hand**, and the levels that are
assigned automatically can only reject a request that could not have worked anyway.

## 2. Current state

| Where | What is there now |
|---|---|
| `packages/core/src/client.ts:234` | `execute()` — builds a `RequestSpec` and enters the attempt loop. No validation anywhere |
| `packages/core/src/request.ts:29` | `resolvePath` already refuses a missing path placeholder and an absolute URL |
| `packages/core/src/request.ts:52` | `buildQuery` already refuses an array-valued query parameter |
| `packages/core/src/operation.ts` | `Operation` carries `requestBody` (`CAT-7`) — 32 real examples, 14 annotated prose, 49 with none |
| `packages/cli/src/execute.ts:53` | the `--dry-run` branch returns **before a client is constructed**, so anything living inside `BrazeClient` never runs on a dry run |
| `packages/core/package.json:26` | `valibot` is already a dependency of core and is imported nowhere yet |

`valibot` is pure ES modules with no Node builtins, so it cannot break `portability:core` — but the
gate runs anyway, because that is what it is for.

## 3. Decisions

### 3.1 The level lives on the operation; the schema does not

`Operation` gains `validation?: "strict" | "generated" | "passthrough"`, defaulting to
`"generated"`. It is data, so it serializes into `generated.ts` and the catalog gate compares it
like every other field.

**Handwritten schemas go in a separate module**, `packages/core/src/operations/schemas.ts`, keyed
by operation id. Not in `overrides.ts`: an override is data merged into an `Operation`, and a
Valibot schema is code — it cannot be written into `generated.ts` or compared by `catalog:check`.
Keeping them apart also means an operation can be marked `strict` in one place and have its schema
in another, so the merge can **fail loudly when a `strict` operation has no schema**, which is the
one way this feature silently becomes a no-op.

### 3.2 What each level actually checks

Every level checks what `resolvePath` and `buildQuery` already check — a resolvable path, scalar
query values. The levels differ **only in what they say about the body**:

| Level | The body |
|---|---|
| `passthrough` | not inspected at all |
| `generated`, with a documented example | must be the same JSON **kind** as the example — object where it is an object, array where it is an array. **Nothing about keys.** |
| `generated`, with no documented body | a body may not be sent at all on a `GET` or `DELETE`. Braze documents none, so passing one is a mistake worth catching without needing a schema |
| `strict` | a handwritten Valibot schema, the only level that may reject on a field |

**`generated` deliberately says nothing about which keys are allowed.** One example is not a
schema: `/users/track`'s example shows `attributes`, `events` and `purchases`, and a request
carrying only `purchases` is perfectly valid, as is one carrying a field Braze added last week.
Checking the kind still catches the real mistake — an array passed where Braze wants an object,
a bare string passed where it wants a payload — and cannot refuse anything that would have worked.

### 3.3 How a level is assigned

Derived by the generator from what `CAT-7` already extracted, then overridable:

| What the collection gave us | Level |
|---|---|
| a real JSON example (32 operations) | `generated` |
| annotated prose, no inferable shape (14) | `passthrough` |
| no body at all (49) | `generated` — on a `GET` or `DELETE` this means "send no body"; on a write with no documented body it checks path and query only, which is behaviourally the same as `passthrough` and is worth knowing rather than discovering |
| a handwritten schema exists | `strict`, and the override must say so |

### 3.4 Validation is a function, not a method

Exported as `validateRequest(operation, input)` from core, called by `BrazeClient.execute` **and**
by the CLI's dry-run branch.

It has to be both, because §550 of the brief says a dry run validates, and
`packages/cli/src/execute.ts:53` returns before a client exists. A dry run that skipped validation
would be the one command whose whole purpose is "tell me if this would work" answering "probably".

### 3.5 `braze api` keeps working unchanged

`rawOperation` sets **`validation: "passthrough"` explicitly**, in `operation.ts`. Leaving it to
the default would be wrong — `defineOperation` defaults to `generated`, and a raw call has no
example to compare a kind against. Setting it at the source makes the escape hatch correct by
construction rather than by a default nobody reading `api.ts` can see. Rule 12 of
[`../HANDOFF.md`](../HANDOFF.md) says the escape hatch must keep working.

### 3.6 Which operations start out `strict`

The brief names the shape: commonly used endpoints, dangerous writes, user data operations,
messaging, subscription changes. **A handful, chosen where Braze's own documentation is
unambiguous**, not all 53 writes. The point of this step is the mechanism plus a proof that it
bites; filling the set out is a later, cheap, incremental job.

Candidates, to confirm against Braze's docs while building: `users.track.create`,
`users.delete.create`, `subscription.status.set.create`, `v2.subscription.status.set.create`,
`messages.send.create`, `campaigns.trigger.send.create`.

### 3.7 Validation runs before the write guards, not after

In `packages/cli/src/execute.ts` the order today is `assertWriteAllowed`, then the dry-run branch.
Validating after that would mean `--dry-run` on a read-only profile reports `permission_error` and
**never tells you the body was malformed** — and the handoff says `--dry-run` is exactly the tool
you reach for when a profile is locked down. It would answer a question nobody asked.

So the order becomes **validate → guard → send**. Validation sends nothing and is about the request
itself; the guards are about whether this request may be sent from here. A read-only profile still
refuses a well-formed write with `permission_error`, unchanged; it now refuses a malformed one with
`validation_error` first, which is the more useful of the two answers and costs the same nothing.

## 4. Work items

1. `validation` on `Operation`; `RequestBodyDoc` already carries what `3.3` keys off.
2. `schemas.ts` — handwritten Valibot schemas by operation id, plus the merge check that a
   `strict` operation without one is a build failure.
3. `validateRequest` in core: path, query, then the body rule for the level.
4. Wire into `BrazeClient.execute` before the attempt loop, and into `runOperation` **before
   `assertWriteAllowed`** — see `3.7`.
5. Generator: derive the level, emit it, and add the `strict` / `generated` / `passthrough` counts
   to `catalog-coverage.md` — §12 of the brief asks for exactly those rows.
6. The strict schemas themselves, for the handful in `3.6` — **each verified against its Braze
   documentation page before it is written**, the way `CAT-13`'s parameter descriptions were.
   `users.delete` and `messages.send` have required-one-of-several-identifier rules that are easy
   to state wrong. **Where a page does not make the rule unambiguous, that operation stays
   `generated`** and the schema module says why. A smaller strict set that is right beats a fuller
   one that guesses, because a wrong `strict` blocks a valid request with no recourse but
   `braze api`.

## 5. Test plan

| What | Where |
|---|---|
| every operation has a level, and every `strict` one has a schema | `catalog.test.ts`, over all 95 |
| `generated` refuses an array where the example is an object, and **accepts an unknown key** | `validate.test.ts` |
| `passthrough` accepts a body nobody can describe | `validate.test.ts` |
| `strict` names the field it refused | `validate.test.ts` |
| a refusal costs **zero** HTTP requests | `client.test.ts`, counting mock calls |
| `--dry-run` validates and refuses | `packages/cli/src/commands/catalog.test.ts` |
| `braze api` is unaffected — `rawOperation` is `passthrough` | `api.test.ts` |
| the level counts appear in the coverage report | the generator gate test |

Gates: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, then
`pnpm catalog:check && pnpm docs:check && pnpm portability:core && pnpm smoke:bun`.

## 6. What will bite

- **A `strict` schema that is wrong is invisible until someone is blocked**, and they cannot
  overrule it except by `braze api`. That is why the set starts small and every schema cites the
  Braze documentation page it came from.
- **Validating in `BrazeClient` alone leaves dry run unvalidated** — §3.4. The two call sites are
  the point, not an accident.
- **`--dry-run` must still work on a read-only profile.** Validation runs after
  `assertWriteAllowed`, so the existing refusal order does not change.
- **The coverage report is a gate.** Adding rows to it changes the committed file, so
  `catalog:generate` has to run in the same commit or `catalog:check` fails CI.

## 7. What changed while building

- **`braze api` is `passthrough` even when the catalog knows the path.** Not in the plan, and it
  had to be: five existing tests went red because `braze api POST /users/track` picked up the new
  strict schema. §11 of the brief ends "`braze api` remains the final escape hatch", so the raw
  command takes the catalog's *classification* (rule 12, `FIND-13`) and not its validation level.
  `packages/cli/src/commands/api.ts` does that explicitly.
- **`BUG-8`, found while writing the first schema.** The catalog recorded `/users/track` as 75 per
  array; Braze documents **75 across the three together** and calls the per-array reading their own
  legacy limit. `BULK-3` would have batched 225 objects into a request that allows 75 and had every
  one refused. `batchTotal` now carries the binding number, `braze schema` prints it beside `batch`,
  and the strict schema enforces it.
- **The GET-body check is unreachable from the CLI**, and that is fine. A generated GET command
  offers no `--input` and `braze api` is passthrough, so it exists for the other audience:
  `brazecli-core` is a package a Worker imports directly.
- **Only two operations are `strict`.** `messages.send.create` and `campaigns.trigger.send.create`
  were candidates in `3.6` and stayed `generated`: their identifier rules interact with audience,
  segment and recipient objects across several documentation pages, and `3.6` says an ambiguous
  page means the operation does not get a schema. `schemas.ts` records why.

## 8. Out of scope

Response validation — Braze's collection carries zero response examples (`FIND-20`), so there is
nothing to validate against and inventing one would be the wrong-schema failure aimed at data we
did not send. PII field marking, which `CAT-4` deferred, stays deferred.
