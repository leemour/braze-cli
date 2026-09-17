# Authentication

A **profile** is one Braze workspace: its REST endpoint, whether writes are allowed, and an API key
held in your OS keyring. Every command that talks to Braze names its profile.

## Creating one

```sh
braze profile add staging --endpoint https://rest.fra-01.braze.eu
```

It asks for the API key and reads it without echoing. Where there is no terminal — CI, a script,
an agent — pipe it in:

```sh
echo "$BRAZE_KEY" | braze profile add ci --endpoint https://rest.fra-01.braze.eu --key-stdin
```

**Never pass the key as a command line argument.** It would be visible in `ps`, in your shell
history and in any process listing. There is deliberately no flag for it.

## The endpoint

The REST endpoint is your Braze cluster, and it differs per customer. Braze maps dashboard URLs to
REST endpoints in [the API overview](https://www.braze.com/docs/api/basics). European workspaces
are on `braze.eu`, not `braze.com`.

A wrong cluster does not fail quietly: with the right key on the wrong cluster Braze answers
`401 Invalid API key`, while the right cluster with an under-permissioned key answers
`403 Access Denied`. That difference is how you tell the two apart.

## Which workspace am I talking to?

**A workspace is chosen by its API key, not by the endpoint.** Two profiles with the same cluster
URL can point at completely different data, and Braze exposes no workspace identifier — nothing in
the API says which workspace a key belongs to.

`braze profile verify` is the closest thing to an answer. It sends one read and reports what the
key can see, including monthly active users, and it can record a ceiling you expect:

```sh
braze profile verify staging --expect-max 10000
braze profile verify staging            # later: fails if the workspace outgrew that ceiling
```

In practice size separates workspaces cleanly — a sandbox with 502 monthly actives against
production's 1.3 million — even when both hold millions of profiles.

## Choosing the profile

```sh
braze staging campaigns list             # first word, the normal way
braze --profile staging campaigns list   # the flag
BRAZE_PROFILE=staging braze campaigns list
```

**There is no default profile, on purpose.** Omitting it is an error that lists the profiles you
have, never a guess. A default is selected by omission, and the thing most easily omitted should
not be the workspace with a million people in it.

Commands that never reach Braze — `profile`, `runs`, `commands`, `schema`, `skill` — take no
profile.

A profile may not be named after a command (`users`, `campaigns`, `api`, `runs`, …). `profile add`
refuses it, because `braze users track` could otherwise mean two things.

## Read-only profiles

```sh
braze profile add production --endpoint https://rest.fra-01.braze.eu --read-only
braze profile add production --no-read-only     # allow writes again
```

A read-only profile refuses every write **before `--confirm` is even considered**. The two guards
are for different mistakes: `--confirm` catches a mistyped command, read-only catches a correct
command aimed at the wrong workspace — including one you pasted from somewhere that already
carried `--confirm`.

Updating one field leaves the others alone: neither the endpoint nor the key has to be retyped.

## Where the key actually lives

In order, first match wins:

1. **`BRAZE_API_KEY`** in the environment.
2. **The OS keyring** — Keychain on macOS, Secret Service on Linux, Credential Manager on Windows.
3. **`credentials.json`** in the config directory, created with permissions `0600`, used only when
   the keyring is unavailable. The fallback prints a one-line warning to stderr the first time it
   happens; it never happens silently.

The keyring is addressed by service name and profile name. Set `BRAZE_CONFIG_DIR` and the service
name changes with it, so a throwaway config directory is a throwaway keyring namespace too — this
is not cosmetic: without it, `BRAZE_CONFIG_DIR=/tmp/x braze profile add staging` would overwrite
the real key for `staging`, which cannot be read back out of a keyring.

Force one or the other with `credentialStorage` in the config file: `auto` (the default),
`keyring`, or `file`.

## In CI, or anywhere with no keyring

Give the whole profile in the environment and configure nothing:

```sh
export BRAZE_API_KEY=…
export BRAZE_REST_ENDPOINT=https://rest.fra-01.braze.eu
braze campaigns list --json
```

These two override any stored profile. Store the key in your CI's secret store — GitHub Actions
secrets, and so on — never in the repository.

## Removing one

```sh
braze profile remove staging     # drops the profile and its stored key
braze profile list
```

Keys are deleted from the keyring, not merely forgotten by the config file.

See also: [configuration.md](configuration.md) for every setting, [security.md](security.md) for
what is written where and what is never written at all.
