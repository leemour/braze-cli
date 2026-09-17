# Usage

Every command that reaches Braze starts with the profile:

```sh
braze <profile> <command…> [options]
```

`braze commands` prints the whole surface; [commands.md](commands.md) is the same list, generated
from the program itself, so neither can describe a version that no longer exists.

## Finding the command you need

```sh
braze commands                       # every command, grouped
braze commands --json                # the same, machine-readable, with the exit code table
braze schema campaigns list          # one operation: parameters, body, whether it writes
braze schema users.track.create      # by operation id
```

`braze schema` answers the question a reference cannot: what exactly does *this* call take, and is
it a read or a write.

## Reads

```sh
braze staging campaigns list
braze staging campaigns list --page 0 --sort-direction desc
braze staging campaigns details --campaign-id abc123
braze staging catalogs items list --catalog-name products
braze staging segments list --json
```

Each Braze endpoint in the catalog is a command. Path placeholders become required options
(`--catalog-name`), documented query keys become optional ones (`--page`), and `--query key=value`
carries anything else — Braze's documented keys are never the whole list.

`--query` is repeatable for **different** keys. Repeating the same key is refused rather than
guessed at.

## Writes

A write needs `--confirm`, always, and it is a flag rather than a prompt — nothing ever blocks
waiting for a keypress:

```sh
braze staging users track --input @users.json --dry-run    # validates and counts, sends nothing
braze staging users track --input @users.json --confirm    # sends
```

Without `--confirm` the command stops with `confirmation_required` (exit code 7) and sends
nothing. On a read-only profile it stops earlier still, with `permission_error` (exit code 5),
whatever flags were given.

`--input` takes `@file`, `-` for standard input, or inline JSON:

```sh
echo '{"attributes":[{"external_id":"u1","plan":"pro"}]}' \
  | braze staging users track --input - --confirm
```

## The escape hatch

```sh
braze staging api GET /campaigns/list --query page=0
braze staging api POST /users/track --input @users.json --confirm
braze staging api DELETE /catalogs/products --confirm
```

`braze api` sends anything Braze accepts, cataloged or not, and takes the same global flags. It
consults the catalog to decide whether a path is a read or a write, and falls back to judging by
HTTP method — which is why the three POST-shaped exports (`/users/export/…`) are allowed on a
read-only profile while every other POST is not.

## Paging

```sh
braze staging campaigns list --paginate
braze staging campaigns list --paginate --max-pages 20 --max-items 5000
```

`--paginate` walks the pages and returns them as one value, under a ceiling it cannot exceed
(10 pages unless you raise it). Without it, a full page prints a note on stderr saying there is
probably more — stdout stays clean.

## Many records at once

```sh
braze staging users track --records users.jsonl --records-field attributes --confirm
```

This is a different mode from `--input`: records stream out of the file, are batched to Braze's
limit, and each one gets an audit row. [bulk.md](bulk.md) covers it properly.

## What a run did

```sh
braze runs list                  # newest first
braze runs list --limit 50
braze runs show <run-id>         # metadata, counts, what was sent and what came back
braze runs path <run-id>         # the directory, for jq, grep or an upload
```

Every invocation that touches Braze writes a directory: `run.json` (what was asked and what
happened), `events.jsonl` (the structured log) and, when more than one record was involved,
`records.csv`. `BRAZE_LOG=debug` makes the log fuller without changing stdout.

```sh
jq '.request' "$(braze runs path 20260917T191500Z-users-track-a81f2c)/run.json"
```

## Output modes

```sh
braze staging campaigns list           # a table, because stdout is a terminal
braze staging campaigns list --json    # one JSON value, whatever stdout is
braze staging campaigns list | jq .    # also JSON: a pipe is not a terminal
```

In a machine mode stdout carries **exactly one JSON value and nothing else**. A failure is one JSON
object on stderr with stdout left empty:

```json
{"error":{"code":"rate_limited","message":"…","retryable":true,"retryAfterMs":3000}}
```

Branch on the exit code rather than on the message:

| | | | |
|---|---|---|---|
| 0 | success | 9 | `timeout` |
| 2 | `validation_error` | 10 | `network_error` |
| 3 | `configuration_error` | 11 | `provider_error` |
| 4 | `authentication_error` | 12 | `provider_unavailable` |
| 5 | `permission_error` | 13 | `invalid_response` |
| 6 | `not_found` | 14 | `outcome_unknown` |
| 7 | `confirmation_required` | 130 | `cancelled` |
| 8 | `rate_limited` | 1 | anything else |

`braze commands --json` publishes this table too, so a script can read it rather than hard-code it.

Driving this from a script or an agent: [agents.md](agents.md).
