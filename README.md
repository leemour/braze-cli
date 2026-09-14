# brazecli

A command line interface for the [Braze](https://www.braze.com/docs/api/basics/) REST API, built
for AI agents and automation first, and for people second.

> **Status: Phase 1 done, verified against live Braze** (2026-09-13). `braze profile`, `braze api`
> and `braze runs` work; a read returns real data and a write is refused without `--confirm`.
> **Typed commands work** — 95 of them, registered from the generated catalog rather than written
> by hand, and `braze api` remains the escape hatch for anything the catalog does not carry.
> Follow along in [`BACKLOG.md`](BACKLOG.md).

## What it is for

- **Agents and scripts** — `--json` gives exactly one deterministic JSON value on stdout, and a
  closed list of error codes to branch on. No parsing of human help text.
- **Bulk work** — hundreds of thousands of user updates, streamed, batched to Braze's limits,
  with one audit row per user and honest per-record status.
- **Debugging** — every run leaves a directory with structured logs and metadata you can grep.
- **People** — tables, colour and a spinner when a terminal is attached.

Underneath is a separate package, `brazecli-core`, that uses Web Platform APIs only and is meant
to run unchanged in a Cloudflare Worker, a browser or a serverless function.

## Install

Not published yet — it goes to npm as `brazecli` at v1, tracked as `OPS-2` in
[`BACKLOG.md`](BACKLOG.md). The typed command is `braze` either way. For now, from a clone:

```sh
pnpm install
pnpm build
```

Requires Node 22+ (24 in CI) and pnpm 11+.

### Install it locally

Nothing is published to npm yet (`OPS-2`), so `braze` gets onto your `PATH` by symlink. `pnpm
build` marks the entry point executable, which is what makes this work:

```sh
pnpm build
ln -sfn "$PWD/packages/cli/dist/bin/braze.js" "${PNPM_HOME:-$HOME/.local/share/pnpm}/bin/braze"

braze --version
```

Any directory already on your `PATH` will do; `$PNPM_HOME/bin` is used above because pnpm has
already put it there. The link points into this checkout, so `pnpm build` updates the command in
place — and moving or deleting the checkout breaks it.

`pnpm link --global` is not the way: pnpm 11 removed it, and `pnpm link` now only links a package
*into* another project.

## Usage

Working today:

```sh
braze profile add production --endpoint https://rest.fra-01.braze.eu --read-only
braze profile list                       # names, endpoints, whether a key exists — never the key

braze api GET /campaigns/list --json     # a read
braze api GET /campaigns/details --query campaign_id=abc

braze api POST /users/track --input @users.json --dry-run   # validates and counts, sends nothing
braze api POST /users/track --input @users.json --confirm   # writes need --confirm, never a prompt

braze runs list                          # what past invocations did
braze runs path <run-id>                 # the directory holding its artifacts

braze commands --json                    # the whole command surface, for an agent
```

```sh
braze campaigns list --json              # typed, registered from the catalog
braze campaigns list --page 0 --include-archived false
braze catalogs items list --catalog-name my-catalog
braze users track --input @users.json --confirm
```

Still to come: `braze schema <id>`, one operation's input contract.

### For an agent

**There is a ready-made prompt in [`docs/agent-prompt.md`](docs/agent-prompt.md)** — copy it into
the agent's instructions and replace one path.

Start with `braze commands --json`. It returns every command, its arguments and its options —
including which options take a value and which must be given — plus the exit code for each kind of
failure, so a caller branches on `$?` rather than parsing a message. It reads the live command
tree, so the typed commands appear there the moment the catalog lands, with no second list to keep
in step.

**Failures are machine-readable too.** In `--json` mode an error is one JSON object on stderr —
`{"error":{"code":"rate_limited","retryable":true,"retryAfterMs":3000,…}}` — while stdout stays
empty, so a refusal can never be mistaken for a result. The exit code is what to branch on
(`braze commands --json` publishes the whole table); the object says which record and how long to
wait.

Every catalog operation is a command in that surface, with its path placeholders as required
named options and its documented query keys as optional ones — so an agent needs nothing but
`braze commands --json` to construct a call. `--query key=value` still works on every command,
because Postman's examples are not a schema and the documented keys are never the whole list.

**A profile can be marked read-only** (`--read-only`), which refuses every write before `--confirm`
is even considered. `--confirm` guards against a mistyped command; this guards against a correct
command aimed at the wrong environment. Recommended for anything pointing at production.

**Credentials** come from the OS keyring, with a warned fallback to a permission-restricted file.
`BRAZE_API_KEY`, `BRAZE_REST_ENDPOINT` and `BRAZE_PROFILE` override it. The API key is never a
recommended command line argument and never reaches a log.

**Writes** require `--confirm` and are never retried automatically — Braze documents no general
idempotency key. A request whose connection died after it was sent is reported as
`outcome_unknown`, not as a failure.

**Run artifacts** live in the platform state directory (`~/.local/share/brazecli/runs/` on Linux),
one directory per invocation: `run.json`, `events.jsonl`, and `records.csv` whenever more than one
logical record was touched.

## Documentation

| | |
|---|---|
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | **start here** — layout, what to read, how to run the checks, the rules |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the two packages, the portability gates, where the API catalog comes from |
| [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) | the full brief this is built against |
| [`docs/TESTING.md`](docs/TESTING.md) | how to check it yourself |
| [`BACKLOG.md`](BACKLOG.md) | what is left to build |

## Development

```sh
pnpm lint                 # biome: format, lint, and the ban on Node APIs inside core
pnpm typecheck
pnpm test
pnpm portability:core     # core bundles for a runtime with no builtins at all
pnpm smoke:bun            # core actually executes under a second runtime
```

## License

MIT.
