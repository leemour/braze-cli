# A prompt for an agent

Copy the block below into an agent's instructions. It is deliberately short: the CLI describes
itself, so the prompt's job is to say *how to ask*, not to list what exists.

Replace `<REPO>` with the absolute path to this checkout. Once the package is published
(`OPS-2`), `braze` will be on `PATH` and the first line becomes just `braze`.

---

```text
You have a Braze CLI. Invoke it as:

  node <REPO>/packages/cli/dist/bin/braze.js

Always pass --json. Discover what it can do before doing anything else:

  braze commands --json

That returns every command, its arguments and options, and the exit code for each kind of
failure. Trust it over anything you remember about this tool.

How to read a result:
- stdout carries data and nothing else. stderr carries diagnostics.
- On failure stdout is EMPTY and stderr holds one JSON object:
  {"error":{"code":"...","message":"...","retryable":true,"retryAfterMs":3000}}
- Branch on the exit code, not on message text. 0 is success. The full table is in
  `exitCodes` from `braze commands --json`; the ones you will actually meet are
  5 permission_error, 6 not_found, 8 rate_limited, 9 timeout, 10 network_error,
  14 outcome_unknown.
- outcome_unknown (14) means a write may or may not have been applied. Do NOT retry it.
  Report it and stop.
- If error.retryable is false, do not retry. If retryAfterMs is present, wait that long.

Reaching Braze:

  braze api <METHOD> <PATH> --json
  braze api GET /campaigns/list --query page=0 --json

There are no typed commands yet, so `api` is the only route, and you must know the path.
The list of paths is at https://www.braze.com/docs/api/home — read it there; the CLI cannot
enumerate them yet.

Rules that will otherwise waste your turns:
- Every write needs --confirm. There is never an interactive prompt.
- The production profile is read-only: writes are refused before --confirm is even considered,
  with permission_error. This is intended. Do not try to work around it, and do not edit the
  config to remove it. Report it and ask.
- Use --dry-run to check a write without sending it. It works on a read-only profile.
- `braze api` decides read-versus-write by HTTP method, so a read that Braze implemented as a
  POST — /users/export/ids is the one that matters — is refused as if it were a write. That is
  a known gap, not something you should route around.
- --query is repeatable for DIFFERENT keys. Repeating the SAME key is refused rather than
  guessed at. If you need that, stop and say so.
- Never put an API key on the command line. It comes from the keyring or BRAZE_API_KEY.

To see what a past invocation did: `braze runs list --json`, then `braze runs show <run-id>`.
```

---

## Why it is shaped this way

**It tells the agent to ask rather than to know.** `braze commands --json` reads the live command
tree, so an instruction to run it stays correct after the catalog lands and hundreds of typed
commands appear. A prompt that listed commands would be wrong the day after it was written.

**The traps are the expensive half.** Each of the rules at the end is something an agent
discovers by burning a turn on a refusal, and two of them — the read-only profile and the
POST-shaped read — look like bugs worth working around if you do not know they are deliberate.

**It says what not to do after a failure**, which matters more than what to do: `outcome_unknown`
is the one state where a retry can double-write, and it is the one an agent is most tempted to
retry.
