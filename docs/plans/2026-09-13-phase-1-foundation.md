# Plan: Phase 1 — foundation

**Done means:** `braze --profile production api GET /campaigns/list --json` reaches real Braze,
returns one deterministic JSON value on stdout, writes a run directory with `run.json` and
`events.jsonl` containing no credentials and no ANSI, and `braze api POST /users/track --input
@x.json` refuses to send without `--confirm`.

Status: **done** (2026-09-13). Kept until the Phase 2 plan replaces it; delete it then. Written against the scaffold commit. Backlog items
`CORE-1`…`CORE-12` and `CLI-1`…`CLI-13` in [`../../BACKLOG.md`](../../BACKLOG.md); brief in
[`../REQUIREMENTS.md`](../REQUIREMENTS.md) §14–§48.

---

## 1. What already exists

pnpm workspace with `packages/core` and `packages/cli`; Biome, strict TypeScript, vitest,
lefthook, CI; the three-layer core portability gate
([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §3); `Logger` + `noopLogger`
(`packages/core/src/logger.ts`) and the closed error-code list plus `BrazeError`
(`packages/core/src/errors.ts`).

Everything below is new code. No Braze call has ever been made from this repository.

## 2. Order of work, and why this order

Five steps. Each one ends green — lint, typecheck, tests, portability — and is committable on its
own. **Step 1 comes first because everything else is tested through it.**

### Step 1 — the mock Braze, before the client `CORE-12` ✅

A fake `fetch` factory covering the behaviours in [`../REQUIREMENTS.md`](../REQUIREMENTS.md) §57:
success, 400/401/403/404/408/429/500/502/503, invalid JSON, network failure, timeout, delayed
response, `Retry-After`, rate-limit headers, and **a connection that dies after the request was
submitted**. Lives in `packages/core/src/testing/` and ships with core, because a Worker consumer
wants it too.

Written first on purpose: the retry, timeout and ambiguous-write rules are only observable through
it, and writing it afterwards tends to produce a mock shaped to match whatever the client already
does.

**Built.** `packages/core/src/testing/`, published as `brazecli-core/testing`, 11 tests. Two
things it settled that the next steps must respect:

- **`hangsUntilAborted` settles only when the caller's signal fires, and there is no delay
  option at all.** A real delay in a mock is a sleep in the test suite. This is what makes step
  2's timeout tests instant — and it is a constraint on step 2, not a convenience.
- **`reachedServer` on a recorded request is for reading a test, never an input to client
  logic.** A dropped connection looks identical to the client either way, so `CORE-7` cannot
  branch on it — see step 3.

### Step 2 — one request, end to end `CORE-1` `CORE-2` `CORE-3` `CORE-8` ✅

`BrazeClient` taking `{ fetch, sleep, clock, random, logger, endpoint, apiKey }`, building a
request from path params and query, sending it, and timing out at 30 s per attempt through
`AbortController`. No retries yet. At the end of this step core can talk to Braze and nothing else
can.

⚠ **The client composes its own `AbortController` and schedules the abort through an injected
timer — not `AbortSignal.timeout(ms)`.** The obvious API makes every timeout test wait in real
time, which is how a timeout suite stops being run. Step 1's mock was built assuming this.

**Built**, 20 tests. Three things step 3 inherits:

- **`send` is one attempt and never classifies.** Any HTTP status comes back as a `Response`,
  500 included. It throws only `timeout`, `cancelled` and `network_error` — the three outcomes
  with no response to classify. Retry and status mapping are `execute`'s, and must not migrate
  into `send` because it is convenient.
- **The timeout timer is cancelled in a `finally`**, along with the listener on the caller's
  signal. `Promise.race` does not cancel the loser; without this it is a pending timer and a
  listener per request, invisible at one and fatal at ten thousand.
- **Which abort fired is tracked by a flag set before aborting**, never by inspecting the error:
  our timeout and the caller's cancellation both arrive from `fetch` as an `AbortError`.

Left open on purpose: array query parameters throw `validation_error` rather than guessing a
serialization Braze is inconsistent about. The generated catalog settles it per operation
(`CAT-3`).

### Step 3 — the safety rules `CORE-4` `CORE-5` `CORE-6` `CORE-7` `CORE-9` ✅

The part that makes this worth building rather than reaching for `curl`:

- HTTP status and Braze's error body normalize into the closed code list.
- One retry by default, reads only, exponential backoff with jitter — **deterministic, because
  `sleep` and `random` are injected**. A retry test that really sleeps is a test nobody runs.
- `Retry-After` and `X-RateLimit-Reset` beat our own backoff; wait is capped at 30 s; beyond that
  a structured `rate_limited` comes back rather than a blocked agent.
- A write whose connection died after the request left becomes `outcome_unknown` — never
  `failed`. This is the single most important behaviour in the phase. **The discriminator is
  whether the operation was a write, not whether the request arrived** — nothing at the fetch
  boundary can tell us it arrived, which is exactly why the state exists.
- Operation metadata carries access, permission, `retryPolicy`, batch limits and pagination style,
  so Phase 2's generated catalog has a shape to fill.

**Built**, 31 tests. What step 4 and Phase 3 inherit:

- **`execute` keeps the raw body**, because a 2xx is not proof every record landed — Braze
  answers `/users/track` with 201 and a populated `errors` array when part of a batch failed.
  `BULK-6` reads that; a layer that discarded it could not tell `submitted` from `success`.
- **Retry branches on `retryPolicy` alone**, not on the policy *and* the access class. An
  operation with `access: "write"` and `retryPolicy: "read-safe"` is a catalog bug for `CAT-4`'s
  override validation to reject — two sources of truth is how one of them ends up wrong.
- **`sleep` takes a reason, `"timeout"` or `"retry"`.** Core waits for exactly two reasons and a
  test has to tell them apart; without it a recorded wait list mixes an attempt's deadline with
  the delay between attempts and can assert on neither.

### Step 4 — the CLI shell `CLI-1` `CLI-2` `CLI-3` `CLI-4` `CLI-11` ✅

Commander with global flags; configuration resolving CLI > environment > profile > global >
default; `braze profile add/list/remove` through Clack; credentials from the OS keyring with a
warned file fallback; `--input @file` and stdin.

**`BRAZE_API_KEY` is read here and nowhere else.** Core receives it as a constructor argument.

**Built**, 44 tests. What step 5 inherits:

- **The keyring is reached through one injected seam**, defaulted to the real `Entry` and
  replaced in every test. "No test touched a real keychain" is a property of the code, not a
  hope that each test remembered to opt out.
- **`auto` does not probe.** It attempts the operation, and on failure warns **once** to stderr
  and writes the file instead. A probe would touch the user's keychain for nothing and could
  still succeed where the real operation fails.
- **The file fallback is `0600` inside a `0700` directory, written atomically** through a temp
  file and a rename — a partial `credentials.json` loses every profile's key, not just the one
  being written, and the window for that is a Ctrl+C during `profile add`. ⚠ Both modes are
  ignored on Windows.
- **`packages/cli/src/output/stream.ts` is the seam step 5 builds on**: two functions, data to
  stdout and everything else to stderr, with no formatting decisions in it. The moment it grows
  a table it has become the renderer early.

### Step 5 — the observable surface `CLI-5` `CLI-7` `CLI-8` `CLI-9` `CLI-10` ✅

Output modes and the invariant test; the Pino adapter and `events.jsonl`; run directories and an
atomically finalized `run.json`; `braze api`; `--dry-run`.

`CLI-5` is where the machine-output invariant becomes real — write that test before the renderer,
not after ([`../TESTING.md`](../TESTING.md)).

## 3. Decisions already taken

| Decision | Value | Why |
|---|---|---|
| Validation | Valibot, not Zod | smaller, tree-shakes into a Worker bundle |
| Concurrency | `p-queue`, never worker threads | HTTP concurrency is not a CPU problem |
| Keyring | `@napi-rs/keyring` | prebuilt, no node-gyp on a user's machine |
| Terminal | Clack + picocolors + cli-table3 | matches the UX the owner already likes |
| Bulk | `AsyncIterable<Record>` from day one | Phase 3 cannot retrofit it |
| Writes | never auto-retried | Braze documents no general idempotency key |

## 4. What will bite

- **Do not let the CLI leak into core.** The moment core reads `process.env`, three gates go red
  and the Worker story is over. If core seems to need something from the environment, pass it in.
- **A batch is not a record.** One `/users/track` request carrying 75 users is 75 audit rows, and
  their status is `submitted`, not `success` — Braze does not acknowledge them individually.
- **`--confirm` is never an interactive prompt for an API command.** Agents and CI need
  determinism; a missing confirmation returns `confirmation_required` and exits.
- **Bun cannot verify portability**, only execute it — see `FIND-1` in
  [`../journal/2026-09-13-repo-setup.md`](../journal/2026-09-13-repo-setup.md).
- **Output default is settled** (`NEED-1`): a TTY gets the pretty renderer, a pipe gets JSON,
  `--json` forces it. Keep the choice behind one function anyway — if agent traffic ever makes
  JSON the better default, that has to be a one-line change, not a rewrite of every command.

## 5. Out of scope

The generated catalog and any hand-written endpoint command beyond `braze api` (Phase 2); the
bulk pipeline and `records.csv` (Phase 3); pagination flags; shell completions; publishing.

A hand-written `campaign list` is tempting as a demo. Don't — Phase 2 generates it, and the
hand-written one then has to be deleted or kept in sync.

## 6. How to know it is done

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm portability:core && pnpm smoke:bun

braze profile add staging                       # keyring entry created, no key on screen
braze --profile staging api GET /campaigns/list --json | jq -e 'type == "object"'
braze api POST /users/track --input @/tmp/one-user.json    # exits `confirmation_required`
braze api POST /users/track --input @/tmp/one-user.json --dry-run
braze runs list                                  # the dry run is there, records.csv is not

grep -c $'\e\[' "$(braze runs path <run-id>)/events.jsonl"   # must print 0
grep -ci 'api.key\|authorization' "$(braze runs path <run-id>)/events.jsonl"   # must print 0
```
