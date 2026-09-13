# Braze CLI — requirements

The brief this repository is built against, recorded verbatim from the owner's specification
(2026-09-13). **It is the source, not a summary.** Where a decision here has since been settled
or overturned, the ruling lives in [`DECISIONS.md`](DECISIONS.md) and that file wins; a
superseded paragraph below is marked, never deleted.

How the work is cut up: [`../BACKLOG.md`](../BACKLOG.md). What exists today:
[`HANDOFF.md`](HANDOFF.md).

---

## Remaining questions

Most product decisions are now made. These can be decided during implementation if unanswered.

1. **Repository visibility** — personal GitHub account, suggested name `braze-cli`, public or
   private? Suggested: public if there is no Blinkist-specific code/config.
2. **npm publishing** — the unscoped `braze-cli` name is already taken. Decide whether to publish
   under a personal npm scope or initially install from GitHub. The architecture should not depend
   on this decision.
3. **Default human vs machine output** — suggested: TTY → pretty, non-TTY → JSON, `--json` always
   forces deterministic JSON, `BRAZE_OUTPUT=json` does the same. Agents should be explicitly
   instructed to always use `--json`. Is this acceptable, or should JSON remain the absolute
   default even in a TTY?
4. **Run artifact retention** — runs/logs/CSVs will accumulate. Suggested: no automatic deletion
   initially; add `braze runs cleanup` later with configurable retention.
5. **Bulk input formats** — suggested eventual support: JSON, JSONL and CSV. JSONL preferred for
   millions of complex/nested records because it streams naturally. CSV is particularly useful for
   flat user attribute updates.

---

## 1. Product goal

Build a high-quality Braze CLI primarily for AI agents, automation/scripts, bulk Braze operations,
debugging Braze integrations, and occasional direct human use.

It should cover nearly the complete Braze REST API while remaining safe, reproducible, observable,
pleasant for humans, deterministic for machines, usable with production and staging, and portable
enough that the Braze client/core can later run in Cloudflare Workers, browsers, serverless
functions or another JS runtime.

The CLI itself may be Node-specific. **The Braze core must not be.**

## 2. Repository architecture

Standalone repository in the personal GitHub account. Suggested layout:

```text
braze-cli/
├── packages/
│   ├── core/src/{client,operations,retry,pagination,bulk,generated}/
│   └── cli/src/{commands,auth,config,output,logging,runs,input}/
├── spec/braze.postman.json
├── scripts/{sync-braze-spec,generate-catalog,generate-docs,check-coverage}.ts
├── docs/
└── tests/
```

Two packages are justified from day one because there is a concrete runtime portability
requirement. Do **not** split further unless necessary.

## 3. Runtime-neutral core

`packages/core` must use Web Platform APIs where practical.

Allowed: `globalThis.fetch`, `Request`, `Response`, `Headers`, `URL`, `URLSearchParams`,
`AbortController`, `Blob`, `FormData`, `crypto.randomUUID()`, `performance.now()`, `setTimeout`,
`ReadableStream` where useful.

Avoid in core: `node:fs`, `node:path`, `node:crypto`, `Buffer`, `process`, `process.env`, Pino,
Commander, Clack, keyring, filesystem configuration, terminal formatting.

The core should be capable of running in environments such as Cloudflare Workers without shims.
The CLI package can be Node 22+.

## 4. Dependency direction

```text
             portable
       ┌────────▼─────────┐
       │   braze-core     │  client · operations · validation
       │                  │  retries · pagination · bulk execution
       └────────┬─────────┘
             adapters
       ┌────────▼─────────┐
       │   braze-cli      │  Commander · keyring · config files · Pino
       │                  │  Clack · colors/tables · CSV/run files
       └──────────────────┘
```

The core should expose APIs usable without Commander.

## 5. Recommended dependencies

**Core:** `valibot`, `p-queue`. Potentially no other runtime dependencies. Use Valibot, not Zod.
The Braze client should accept/internally use standard `fetch`.

**CLI:** `commander`, `@napi-rs/keyring`, `pino`, `@clack/prompts`, `picocolors`, `cli-table3`,
`env-paths`, `csv-parse`, `csv-stringify`. Some may be omitted if equivalent functionality can be
implemented simply. Avoid dependency minimalism for its own sake; prefer well-maintained tiny
packages over reimplementing CSV escaping, terminal detection, etc.

## 6. API catalog strategy

Do **not** dynamically fetch Braze's Postman collection every time the CLI starts. Do **not**
manually maintain hundreds of endpoints. Use a hybrid:

```text
official Braze Postman collection
  → explicit dev-time sync → spec/braze.postman.json
  → normalizer/generator → generated catalog + coverage report
  → + handwritten overrides → bundled operation manifest
  → CLI dynamically constructs commands
```

This gives dynamic command construction without runtime dependence on Postman.

## 7. Why not runtime Postman loading?

A live Postman dependency would mean someone edits Braze Postman → our CLI behavior changes →
without a CLI release. That is undesirable. It would also create a network dependency at startup,
slower startup, potential availability problems, difficult reproducibility, difficult testing,
unexpected breaking changes, and potential supply-chain/trust problems.

Instead, updates to Braze's API should produce a visible Git diff and be reviewed.

## 8. Braze spec sync

Provide `npm run spec:sync`. It should download/export the latest official Braze Postman
collection and update `spec/braze.postman.json`, recording metadata such as:

```json
{ "source": "...", "syncedAt": "...", "sourceCollectionId": "...", "sha256": "..." }
```

Exact mechanics depend on how reliably the public Postman collection can be exported. If Postman
requires authentication for the raw collection API, the sync script may require a Postman API token
or accept a manually exported collection.

**This is development tooling only. Runtime must never require Postman.**

## 9. Catalog generation

Provide `npm run catalog:generate`. For every Postman request attempt to extract: Postman request
ID, folder/resource hierarchy, request name, HTTP method, URL path, query parameters, path
parameters, request body example, descriptions, documentation/source URL, headers.

Generate a normalized operation catalog. Every operation should have a stable ID, preferring the
Postman request ID, with fallback identity `METHOD + normalized path`.

## 10. Handwritten overrides

Postman is not sufficiently precise to define our entire CLI automatically. Maintain
`operations/overrides.ts`. Overrides can specify: command name, description, read/write
classification, Braze permission, Valibot schema, argument aliases, pagination, batch size, retry
semantics, safety constraints, examples, PII fields, result renderer, ignored/deprecated state.

```ts
override("/users/track", {
  command: ["users", "track"],
  access: "write",
  permission: "users.track",
  batch: { attributes: 75, events: 75, purchases: 75 },
  schema: userTrackSchema
})
```

Exact syntax is up to implementation.

## 11. Validation levels

We cannot assume Postman's examples constitute complete API schemas. Support different validation
quality levels: `strict`, `generated`, `passthrough`.

- **Strict** — handwritten Valibot schema. Use for commonly used endpoints, dangerous writes, user
  data operations, messaging, subscription changes.
- **Generated** — validate basic generated metadata: required path params, known primitive query
  params, obvious body shape.
- **Passthrough** — used when the catalog knows the endpoint but cannot reliably infer its body.
  Still validate the request itself but permit arbitrary JSON body properties.

`braze api` remains the final escape hatch.

## 12. Catalog coverage

The generator must never silently drop an endpoint. Generate a coverage report:

```text
Braze requests:           523
generated:                497
strict overrides:          63
passthrough:               21
explicitly ignored:         5
unsupported/ambiguous:      0
```

(Numbers illustrative.) CI should fail if an operation disappears unintentionally or an
unclassified/ambiguous endpoint appears. Provide `npm run catalog:check`.

## 13. Command creation

Commands should be dynamically constructed from the bundled generated catalog. Do not create
hundreds of nearly identical handwritten Commander files.

```ts
for (const operation of catalog) registerCommanderCommand(operation)
```

Handwritten commands are appropriate for special functionality: `profile`, `runs`, `api`, `schema`,
`commands`, `completion`.

## 14. Raw API escape hatch

Required in v1:

```bash
braze api GET /campaigns/details --query campaign_id=abc
braze api POST /users/track --input @request.json --confirm
```

Support at least `GET POST PUT PATCH DELETE HEAD`. Raw semantics: `GET`/`HEAD` → read;
`POST`/`PUT`/`PATCH`/`DELETE` → write, `--confirm` required — even though some Braze POST endpoints
are logically reads. Typed catalog operations can override this.

## 15. Profiles

Initial environments `production` and `staging`, but support arbitrary named profiles.

```bash
braze profile add production
braze profile list
braze --profile production users export ...
```

Resolution: `--profile` > `BRAZE_PROFILE` > configured default profile. No automatic per-directory
switching in v1.

## 16. Credential storage

Required behavior: environment override → OS keyring → file fallback. Support `auto`, `keyring`,
`file`; default `auto`, meaning keyring first, and if unavailable warn then fall back to a
protected local file.

Environment variables: `BRAZE_API_KEY`, `BRAZE_REST_ENDPOINT`, `BRAZE_APP_ID`, `BRAZE_PROFILE`.

**Never expose the API key as a recommended CLI argument.**

## 17. Configuration

Hierarchy: CLI option > environment > profile config > global config > default.

```json
{
  "version": 1,
  "defaultProfile": "production",
  "credentialStorage": "auto",
  "http": {
    "timeoutMs": 30000, "retries": 1, "retryBaseDelayMs": 250,
    "retryMaxDelayMs": 10000, "maxRetryAfterMs": 30000
  },
  "bulk": { "concurrency": 4 },
  "output": { "format": "auto", "color": "auto" },
  "logging": { "level": "info" },
  "profiles": {
    "production": { "restEndpoint": "https://..." },
    "staging": { "restEndpoint": "https://..." }
  }
}
```

## 18. HTTP abstraction

Core exposes a reusable `BrazeClient`. It must own: base endpoint, authentication, request
construction, query serialization, body serialization, multipart, timeouts, retry logic,
rate-limit handling, request timing, error normalization, request IDs.

**No endpoint command may implement its own HTTP retry logic.**

## 19. Inject fetch

```ts
new BrazeClient({ fetch: customFetch })
```

Default `globalThis.fetch`. This gives Cloudflare compatibility, browser/serverless compatibility,
straightforward mocking, and deterministic tests.

Also consider injectable `sleep()`, `clock()`, `random()` for deterministic retry tests. Do not
overbuild a dependency injection framework — simple function dependencies are enough.

## 20. HTTP timeouts

Default 30 seconds per attempt, configurable globally and per invocation. Timeout every attempt; no
request may hang indefinitely. Use Web-standard abort behavior. A timeout becomes a normalized
`timeout` error.

## 21. Retry semantics

User-configured default: **1 retry** — initial attempt plus a maximum of one retry, two attempts
total. Retry only operations classified as safely retryable.

Default read retry conditions: HTTP 408, HTTP 429, HTTP 5xx, transient network errors, timeout.

Use exponential backoff plus jitter. Suggested base delay 250 ms, maximum delay 10 s. Exact
algorithm may be chosen during implementation.

## 22. Rate limits

Inspect `Retry-After`, `X-RateLimit-Reset` and any other documented Braze rate-limit headers.
Provider-specified retry timing takes precedence over our normal backoff. Cap automatic waiting;
suggested `maxRetryAfterMs = 30 seconds`. If Braze asks us to wait significantly longer, return a
structured retryable rate-limit error rather than leaving the agent blocked indefinitely.

## 23. Write retries and idempotency

Assume Braze writes are **not generically idempotent**. Do not implement automatic write retry by
default. The current Braze API material does not appear to document a general Stripe-like
`Idempotency-Key` facility.

Operation metadata should support `retryPolicy`: `read-safe`, `idempotent`, `never`. Default for
writes: `never`. If Braze later documents endpoint-specific idempotency, mark that specific
operation accordingly.

Do not assume `external_id`, `send_id` or `campaign_id` are general idempotency keys.

## 24. Ambiguous write failures

This case is critical: POST sent → Braze may process it → connection dies before the response
arrives. The CLI must NOT report this as simply `failed`. Use `unknown` / `outcome_unknown` and
clearly report:

> Request may have been processed by Braze. It was not retried automatically.

This state must also appear in CSV audit output.

## 25. Request timing

Measure every attempt using a monotonic timer. Track `attempt_duration_ms`, `total_duration_ms`,
`retry_wait_ms`. For bulk operations additionally: records/sec, batches/sec, elapsed, estimated
remaining. ETA is human UX only and need not be precise.

## 26. Structured logging

Use Pino in the CLI package. Do not expose Pino throughout the codebase. Core accepts a small
logger interface:

```ts
interface Logger {
  debug(event: object, message?: string): void
  info(event: object, message?: string): void
  warn(event: object, message?: string): void
  error(event: object, message?: string): void
}
```

Provide a no-op/default logger in core. The CLI adapts Pino to this interface.

## 27. Logging vs terminal rendering

These must be separate concepts. **Logger** → machine/debug/audit information: Pino, structured
JSON, persisted to file, no ANSI escape sequences, no terminal colors, preferably no decorative
emojis. **Renderer** → human-facing terminal UX: Clack/picocolors/cli-table3, colors, spinners,
symbols, emojis where useful, tables, human-readable summaries.

Never send Clack/spinner output into persistent log files.

## 28. HTTP logging

Log structured metadata for every HTTP attempt:

```json
{ "event": "http.request", "run_id": "...", "request_id": "...", "operation": "users.track",
  "profile": "production", "method": "POST", "path": "/users/track", "attempt": 1,
  "timeout_ms": 30000 }
{ "event": "http.response", "run_id": "...", "request_id": "...", "status": 201, "attempt": 1,
  "duration_ms": 187, "rate_limit_remaining": 914 }
{ "event": "http.retry", "attempt": 2, "reason": "rate_limited", "wait_ms": 1427 }
```

Never persist full user payloads by default.

## 29. Log redaction

Pino redaction should cover at least: `authorization`, `Authorization`, `apiKey`, `api_key`,
`BRAZE_API_KEY`, `token`, `accessToken`, `access_token`, `password`.

But do not rely solely on Pino redaction — sensitive values should generally never be passed to the
logger. Do not log complete emails, phone numbers, user attributes, request bodies or user export
responses.

## 30. Run directories

Every CLI invocation that performs a Braze operation receives a `run_id`. Persist run artifacts
under a platform-appropriate state/data directory (on Linux conceptually
`~/.local/state/braze-cli/runs/`). Use `env-paths` or equivalent so Windows/macOS locations are
correct.

```text
runs/2026-09-12/20260912T191500Z-users-track-a81f2c/
├── run.json
├── events.jsonl
└── records.csv
```

`records.csv` exists only when relevant. Allow override via `BRAZE_RUNS_DIR` and `--runs-dir`.

## 31. run.json

Write sanitized metadata:

```json
{
  "runId": "...", "command": "users track", "operation": "users.track", "profile": "production",
  "startedAt": "...", "completedAt": "...", "status": "success",
  "inputRecords": 10000, "submittedRecords": 9975, "failedRecords": 25, "unknownRecords": 0,
  "httpRequests": 134, "httpRetries": 2, "durationMs": 189234,
  "cliVersion": "...", "catalogVersion": "..."
}
```

Never include the API key. Do not persist full request bodies by default. Update final metadata
atomically at completion.

## 32. Persistent logs

Every run gets `events.jsonl`; Pino writes structured log events there. JSONL is preferable to
formatted text because it can later be grep'ed, jq'ed, ingested, analyzed. No color escape codes.
Terminal pretty output is completely separate.

## 33. CSV audit records for updates

Any operation modifying **more than one logical record** must create `records.csv`. This includes
one Braze HTTP request containing 75 user updates — do not consider that a "single update" merely
because it was one network request. One CSV row per logical user/record.

Suggested columns: `row_number`, `batch_id`, `operation`, `external_id`, `braze_id`,
`user_alias_name`, `user_alias_label`, `started_at`, `completed_at`, `status`, `http_status`,
`attempts`, `duration_ms`, `error_code`, `error_message`.

Not every identifier will be available. Leave missing fields blank.

## 34. CSV status semantics

Use truthful statuses: `planned`, `submitted`, `failed`, `unknown`, `invalid`, `skipped`.

Do NOT call an individual user `updated` or `success` unless Braze actually confirms that
individual record. For a successful `/users/track` batch without per-user acknowledgements,
`submitted` is safer. For a network failure after the request may have reached Braze, `unknown`.
For dry run, `planned`.

## 35. CSV privacy

Audit CSVs should intentionally contain much less information than the source input. Do NOT persist
arbitrary user attributes. Keep identifiers, timestamps, batch/reference information, status, error
information. Potentially allow explicitly configured additional audit columns later. Never
automatically duplicate all incoming user data into the audit file.

## 36. Million-record runs

Bulk processing must be streaming. Do not read 2 million records into a giant JS array. Instead:
input stream → parser → batcher → bounded queue → Braze → stream CSV audit result. Memory
consumption should remain approximately bounded regardless of total input size.

## 37. Bulk input

Architect the bulk executor around `AsyncIterable<Record>`. This allows inputs from CSV, JSONL, a
database, generated data or another application without changing bulk logic. For very large
structured input, recommend JSONL rather than one huge JSON array. CSV support is particularly
useful for flat attribute updates.

## 38. Bulk execution

Use `p-queue`. Do not use worker threads merely for HTTP concurrency. Default concurrency 4,
configurable, suggested safe range 1–32. Batch records according to Braze limits **before**
concurrency:

```text
750,000 users → 75 users/Braze request → 10,000 batches → 4 concurrent HTTP requests
```

## 39. Bulk flow control

Support bounded queue depth, bounded concurrency, rate-limit pauses, streaming input, streaming CSV
output. Do not allow the parser to enqueue two million pending Promises. Apply backpressure.

## 40. Graceful shutdown

Handle `SIGINT` and `SIGTERM`. For bulk operations: stop reading input → stop scheduling new
requests → allow/abort active requests according to safety → flush CSV → flush logs → write final
`run.json` → exit. Ctrl+C must not corrupt the audit file.

## 41. Checkpoint/resume

Because million-record jobs are possible, design the run format so checkpoint/resume can be added.
It does not have to be fully implemented in the first release if it substantially delays v1, but do
not make the architecture incompatible with it.

Future: `braze run resume <run-id>`. The audit CSV/run state should make it possible to determine
which source records were submitted, failed, unknown or not started.

## 42. Pretty terminal UX

Human UX is important. Borrow the style already used successfully in the Blinkist CLI: intro/outro,
spinner, notes, success/error messages, small useful emojis. Use Clack for
interactive/configuration/long-running UX.

Use colors by default when stdout/stderr is a TTY. Support `--no-color` and `NO_COLOR`; optionally
respect `FORCE_COLOR`. Never emit ANSI colors into JSON, CSV, `events.jsonl` or piped machine
output.

## 43. Output modes

`auto`, `pretty`, `json`, `jsonl`.

- **auto** — TTY → pretty, non-TTY → json.
- **pretty** — human-oriented: tables, headings, colors, progress, summary.
- **json** — exactly one deterministic JSON value on stdout. No spinner, no decorations, no colors.
- **jsonl** — useful for streaming/paginated results where appropriate. No decorations.

Agents should use `braze ... --json` or `BRAZE_OUTPUT=json`.

## 44. Machine-output invariant

When output mode is JSON/JSONL: **stdout = data only, stderr = diagnostics only.** No `✓ Success!`,
no `Loading…`, no emoji banners, no warnings, no progress bars may contaminate stdout.

**This contract must have tests.**

## 45. Pretty rendering

List-like API responses should render as tables where sensible:

```text
📣 Campaigns

NAME                    ID          STATUS
Summer Sale             91f...      active
Retention EU            aa7...      draft

✓ 2 campaigns · 183 ms
```

Object responses can render as grouped key/value sections. Unknown/generic responses may fall back
to pretty-printed JSON. Avoid creating dozens of bespoke renderers initially.

## 46. Dry run

All writes support `--dry-run`. Dry run resolves the profile, resolves the operation, validates
input, batches if relevant, constructs requests, calculates counts, creates run/audit files if
appropriate, and does NOT send HTTP requests.

Pretty mode should summarize profile, endpoint, operation, record count, batch count, concurrency.
Sensitive payload values must not be dumped casually.

## 47. Write confirmation

All writes require `--confirm`. Normal API commands must NOT interactively ask "Are you sure?"
because agents/CI require determinism. A missing confirmation returns `confirmation_required`.
Interactive profile/setup commands may use prompts.

## 48. Error model

Normalize errors. Minimum codes: `validation_error`, `configuration_error`, `authentication_error`,
`permission_error`, `not_found`, `confirmation_required`, `rate_limited`, `timeout`,
`network_error`, `provider_error`, `provider_unavailable`, `invalid_response`, `outcome_unknown`,
`cancelled`.

Include where available: HTTP status, retryability, attempt count, request ID, run ID, retry-after,
operation. **Never include credentials.**

## 49. Pagination

Generated catalog metadata should describe `none`, `page`, `offset`, `cursor`. Default remains one
API page unless endpoint semantics dictate otherwise. Support `--paginate`, `--max-pages`,
`--max-items`. Automatic pagination must always be bounded. Large streaming results should support
JSONL instead of forcing a giant combined JSON array.

## 50. Command/schema discovery

Agents should not need to parse human `--help`. Required: `braze commands --json`, and preferably
`braze schema users.track`.

Output should expose: operation ID, command, description, method, path, read/write, permission,
input schema, pagination, batch limits, retry semantics, documentation URL.

This can later become the source for MCP tool definitions.

## 51. Documentation generation

Documentation must come from the same operation catalog. Provide `npm run docs:generate` and
`npm run docs:check`.

Generated docs should include every typed operation: command, description, Braze permission,
method/path, read/write state, arguments, input schema, batch limits, pagination, example
invocation, dry-run example where relevant, Braze source documentation.

CI fails if generated docs are stale.

## 52. Documentation structure

Keep handwritten: `README.md`, `docs/architecture.md`, `docs/authentication.md`,
`docs/configuration.md`, `docs/bulk-runs.md`, `docs/security.md`, `docs/development.md`.

Generate: `docs/commands.md`, `docs/catalog-coverage.md`.

Possibly generate one command file per resource later if one giant document becomes unwieldy.

## 53. README

The README should answer quickly: What is it? How do I install it? How do I configure
production/staging? How do credentials work? How do I run a read? How do I safely run a write? How
do I use `--dry-run`? How do I use JSON mode? Where are logs/run CSVs? How do I use `braze api`?

Do not make users read architecture documentation for basic setup.

## 54. Mocking and testability

Core must be built explicitly for easy testing. `BrazeClient` accepts injected `fetch`, `sleep`,
`clock`, `random`, `logger` where helpful.

```ts
const client = new BrazeClient({ fetch: mockFetch, sleep: fakeSleep })
```

This allows retry/backoff tests without actually sleeping.

## 55. Test layers

**Core unit tests:** request construction, query encoding, body encoding, Valibot validation,
timeout, cancellation, retry classification, one-retry default, backoff, jitter, `Retry-After`,
rate-limit reset, error normalization, pagination, batching, queue backpressure.

**Generator tests:** use committed fixture Postman collections. Test folder → command mapping, path
normalization, query extraction, body extraction, stable IDs, overrides, duplicate commands,
ignored endpoints, unsupported endpoints, coverage calculation. Snapshot generated manifests where
useful.

## 56. Generated-operation contract tests

For **every generated operation**, automatically verify basic invariants: valid unique operation ID,
valid method, valid path, unique CLI command, known access type, documentation/source exists, all
path variables resolvable, schema can be loaded, operation can construct a request.

This gives broad coverage across hundreds of endpoints without manually writing hundreds of tests.

## 57. Mock Braze

Create a reusable Braze mock layer: fetch injection for unit tests plus MSW or equivalent for
integration-level HTTP mocking.

Mock behaviors: success, 400, 401, 403, 404, 408, 429, 500, 502, 503, invalid JSON, network
failure, timeout, delayed response, `Retry-After`, rate-limit headers, connection failure after
request submission.

Do not make the main test suite depend on actual Braze.

## 58. Automatic mock tests from catalog

Where the Postman collection contains examples, use them to generate basic tests: operation example
input → request builder → mock Braze → expected method/path/query/body.

Do not trust examples enough to replace handwritten correctness tests for important endpoints, but
they can provide broad smoke coverage.

## 59. Live Braze tests

Have an optional `npm run test:live`. Live tests must default to read-only. Never send actual write
requests automatically. Write live tests should require an additional explicit opt-in and dedicated
safe fixture/profile if ever introduced. CI should normally use mock Braze.

## 60. Spec drift tests

Normal CI must be deterministic and use the committed Braze Postman snapshot. Do NOT fetch the
latest Postman collection on every PR build.

Optionally have a scheduled GitHub Action (daily/weekly) that fetches the current Braze collection,
compares it with the committed snapshot and reports drift / opens a PR. This is a good later
enhancement.

## 61. Worker portability tests

Add a build/test guard ensuring `braze-core` contains no accidental Node dependencies: a lint rule
banning `node:*`, a ban on `process`/`Buffer`, bundling core with a browser/neutral target, and
optionally a smoke test of a tiny Cloudflare Worker build importing `BrazeClient`.

This should catch portability regressions immediately.

## 62. Terminal tests

Explicitly test pretty TTY output, JSON output, non-TTY auto mode, `--no-color`, `NO_COLOR`, no ANSI
in logs, no ANSI in JSON, no spinner in JSON mode. Snapshot tests are useful for the pretty
renderer. Do not excessively snapshot implementation details.

## 63. Run-artifact tests

Test run directory creation, `run.json` finalization, Pino JSONL logs, redaction, CSV streaming, CSV
escaping, multi-user audit rows, unknown write outcome, Ctrl+C flushing, million-record simulation
without high memory growth. A synthetic large stream can test scale without actually creating
millions of HTTP calls.

## 64. Security

Never log or display API keys. Require HTTPS except explicit localhost/test use. Do not send
production credentials to an arbitrary endpoint accidentally.

Raw `braze api` should accept relative Braze paths by default (`/users/track`) rather than arbitrary
absolute URLs. If arbitrary URLs are ever supported, require explicit unsafe opt-in.

## 65. User-Agent

Send something like `braze-cli/<version> runtime/<runtime> platform/<platform>` when running from
the CLI. Core should allow callers such as Cloudflare Workers to provide their own user agent
metadata. Do not include machine/user-identifying data.

## 66. Background behavior

No daemon. No hidden worker process. Long jobs remain attached to the calling process. Pino should
not require elaborate worker transports merely to log — use normal streaming file output.

## 67. Commands outside the Braze API

Suggested utility surface: `braze profile ...`, `braze runs ...`, `braze commands --json`,
`braze schema ...`, `braze api ...`.

Potential run commands: `braze runs list`, `braze runs show <run-id>`, `braze runs path <run-id>`.
Cleanup/resume can come later.

## 68. Shell completions

Nice-to-have, not blocking. Commander/catalog structure should make future bash/zsh/fish completion
generation possible. Do not spend significant v1 effort here.

## 69. Reuse from the existing braze-cli

Retain the best ideas: declarative operation catalog, Commander, JSON input, `@file` input, write
confirmation, semantic read/write classification, safe read retries, structured errors,
Braze-specific validation, generated documentation, read-only live tests.

Improve: multi-profile auth, keyring storage, portable core, generated endpoint catalog, raw API,
dry-run, pretty output, run artifacts, structured logs, bulk streaming/concurrency, pagination,
machine-readable schemas.

## 70. Existing Blinkist CLI influence

Borrow its terminal UX style rather than its architecture. Useful patterns: Clack intro/outro, Clack
spinner, notes, select/confirm for setup, small meaningful emoji usage, friendly setup errors.

Do not copy: an interactive menu as the primary command dispatch, `.env.local` as primary Braze
credential storage. Braze API commands must remain direct and automation-safe.

## 71. Implementation phases

**Phase 1 — foundation:** repo/workspaces, portable core, Commander CLI, profiles, keyring + file
fallback, configuration, Pino run logging, pretty renderer, output modes, `BrazeClient`, timeouts,
read retry + jitter, rate-limit handling, structured errors, run directories, dry-run, confirm, raw
API, Valibot.

**Phase 2 — API generation:** Postman sync, normalizer, generated operation catalog, overrides,
dynamic command registration, coverage report, generated docs, schema discovery, generator tests.

**Phase 3 — bulk/audit:** `AsyncIterable` bulk pipeline, CSV/JSONL parsing, Braze batching,
`p-queue`, backpressure, `records.csv`, streamed audit state, graceful cancellation, progress UI.

Given that thousands of updates are already expected, Phase 3 should probably be part of the first
practically useful release rather than postponed indefinitely.

**Phase 4 — huge jobs:** checkpoint/resume, adaptive rate limiting, more sophisticated failure
recovery, scheduled spec drift PRs, a Cloudflare-specific consumer/package, MCP generation.

## 72. Definition of done

A v1 should comfortably support:

```bash
braze profile add production
braze profile add staging
braze --profile production campaign list
braze campaign get --campaign-id abc
braze users track --input @users.json --dry-run
braze users track --input @users.json --confirm
braze users track --input @users.jsonl --confirm --concurrency 4
braze api GET /campaigns/details --query campaign_id=abc
braze api POST /users/track --input @payload.json --dry-run
braze campaign list --json
BRAZE_OUTPUT=json braze campaign list
BRAZE_LOG=debug braze campaign get --campaign-id abc
BRAZE_API_KEY=... BRAZE_REST_ENDPOINT=... braze campaign list
```

And satisfy these invariants:

- production and staging profiles work; OS keyring is preferred; file fallback works safely
- core has no Node dependency; the CLI works on Linux/macOS/Windows
- 30 s default timeout; one read retry by default; backoff + jitter; rate-limit headers respected;
  writes not automatically retried
- ambiguous writes become `outcome_unknown`
- pretty terminal mode looks good; colors default in a TTY; `--no-color` works; JSON mode is
  completely clean
- each run has structured metadata/logs; logs contain no ANSI colors; multi-record writes always
  generate an audit CSV; the audit CSV contains identifiers/status, not complete attributes
- bulk operations are streamed; millions of records do not require millions of records in memory
- the official Postman collection can be synced; a near-complete REST catalog is generated; every
  Postman endpoint is accounted for; generated commands are dynamically registered; the raw API
  covers anything missing
- docs are generated from the same catalog; stale docs fail CI
- Braze is fully mockable; the generator has fixture/snapshot/coverage tests; every generated
  operation gets contract validation; optional live tests are read-only by default

## 73. Core design principles

When tradeoffs arise:

```text
correctness > safety > auditability > agent determinism > portability > debuggability
> human UX > implementation cleverness
```

Avoid magic. But also avoid making the CLI ugly merely because agents use it. The intended result:
a pleasant modern CLI for a human, a strict deterministic API for an agent, and a portable Braze
library underneath.
