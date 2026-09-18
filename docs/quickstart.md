# Quickstart

`braze` reads from and writes to the [Braze](https://www.braze.com/docs/api/basics/) REST API from
your terminal or a script.

## Advantages

- **Shorter than curl.** `braze production campaigns list` instead of a URL, an auth header and a
  query string assembled by hand every time.
- **Harder to get wrong.** Every write needs `--confirm`, `--dry-run` validates and counts without
  sending anything, and the workspace is named in the command itself — there is no default profile,
  so nothing lands in production because a flag was forgotten.
- **Safer with credentials.** The API key goes to your OS keyring. Never a config file, never a
  command line argument, never your shell history, never a log.
- **Access you control.** A profile marked read-only refuses writes outright, before `--confirm` is
  even considered. Keep one profile per workspace and mark production read-only.
- **A record of everything.** One directory per run: what was sent, what came back, how long it
  took.
- **Serves a person and a script.** A terminal gets tables; a pipe or `--json` gets one JSON value.

Unlike an MCP server it needs no server process and no agent runtime — it runs in any shell and any
CI job.

## Install

Needs **Node 22 or newer**.

```sh
npm install -g @leemour/brazecli
```

Create an API key in the Braze dashboard under **Settings → APIs and Identifiers**, granting only
the permissions you actually need ([Braze's instructions](https://www.braze.com/docs/api/basics/)).
The same page lists the **REST endpoint** for each dashboard URL — it differs per customer, and
European workspaces are on `braze.eu`, not `braze.com`.

Add the workspace as a profile. `--read-only` makes it refuse every write:

```sh
braze profile add production --endpoint https://rest.REPLACE-ME.braze.eu --read-only
```

It asks for the key and reads it without echoing. Then check it landed:

```sh
braze profile verify production
```

That prints the endpoint, `readOnly true`, and the workspace's monthly active users — if that
number is not the size you expect, the key belongs to a different workspace.

## Use

The profile name comes first, always.

```sh
braze production campaigns list
braze production segments list
braze production campaigns details --campaign-id <id>

braze production campaigns list --json | jq -r '.campaigns[].name'
braze production api GET /campaigns/list --query page=0
```

`braze commands` lists everything available, and `braze schema campaigns list` explains one command
— its parameters, and whether it writes.

Full documentation: <https://github.com/leemour/brazecli>
