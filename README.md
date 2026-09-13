# braze-cli

A command line interface for the [Braze](https://www.braze.com/docs/api/basics/) REST API, built
for AI agents and automation first, and for people second.

> **Status: scaffold.** The workspace, the checks, CI and the documentation exist. **No command
> talks to Braze yet.** Everything below the install section describes the target shape, and is
> here so the design can be reviewed before it is built. Follow along in
> [`BACKLOG.md`](BACKLOG.md).

## What it is for

- **Agents and scripts** — `--json` gives exactly one deterministic JSON value on stdout, and a
  closed list of error codes to branch on. No parsing of human help text.
- **Bulk work** — hundreds of thousands of user updates, streamed, batched to Braze's limits,
  with one audit row per user and honest per-record status.
- **Debugging** — every run leaves a directory with structured logs and metadata you can grep.
- **People** — tables, colour and a spinner when a terminal is attached.

Underneath is a separate package, `@braze-cli/core`, that uses Web Platform APIs only and is meant
to run unchanged in a Cloudflare Worker, a browser or a serverless function.

## Install

Not published yet — see `OPS-2` in [`BACKLOG.md`](BACKLOG.md). For now, from a clone:

```sh
pnpm install
pnpm build
```

Requires Node 22+ (24 in CI) and pnpm 11+.

## Planned usage

```sh
braze profile add production            # asks for the REST endpoint and the API key
braze profile add staging
braze profile list

braze --profile production campaign list          # a read
braze campaign get --campaign-id abc

braze users track --input @users.jsonl --dry-run  # validates and counts, sends nothing
braze users track --input @users.jsonl --confirm  # writes need --confirm, never a prompt

braze api GET /campaigns/details --query campaign_id=abc   # anything not yet typed
braze commands --json                              # the whole command surface, for an agent
```

**Credentials** come from the OS keyring, with a warned fallback to a permission-restricted file.
`BRAZE_API_KEY`, `BRAZE_REST_ENDPOINT` and `BRAZE_PROFILE` override it. The API key is never a
recommended command line argument and never reaches a log.

**Writes** require `--confirm` and are never retried automatically — Braze documents no general
idempotency key. A request whose connection died after it was sent is reported as
`outcome_unknown`, not as a failure.

**Run artifacts** live in the platform state directory (`~/.local/state/braze-cli/runs/` on Linux),
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
