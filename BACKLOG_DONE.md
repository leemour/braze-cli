# Closed backlog items

Where a number went when it left [`BACKLOG.md`](BACKLOG.md). One line each, newest first. Nothing
is ever removed from this file.

| Number | Task | Closed | Commit |
|---|---|---|---|
| `CLI-11` | Input from `@file`, `-` for stdin, or inline JSON — parsed and refused before a command can half-send it | 2026-09-13 | see `git log -- packages/cli/src/input` |
| `CLI-4` | Credentials: OS keyring first with a single warned fallback to a `0600` file in a `0700` directory, written atomically. The keyring is reached through one injected seam, so no test can touch a real keychain | 2026-09-13 | see `git log -- packages/cli/src/auth` |
| `CLI-3` | `braze profile add/list/remove`. The key is never a command line argument and never printed, masked or otherwise | 2026-09-13 | see `git log -- packages/cli/src/commands/profile.ts` |
| `CLI-2` | Configuration hierarchy in one function — CLI option > environment > profile > global > default — with `env-paths` for locations and a valibot schema that names the offending field | 2026-09-13 | see `git log -- packages/cli/src/settings.ts` |
| `CLI-1` | Commander bootstrap, the global flags, and failures turned into one stable exit code per error code | 2026-09-13 | see `git log -- packages/cli/src/program.ts` |
| `CORE-9` | Operation metadata — access, permission, `retryPolicy`, batch limits, pagination style; `rawOperation` for `braze api`. Retry branches on the policy alone, so there is one source of truth | 2026-09-13 | see `git log -- packages/core/src/operation.ts` |
| `CORE-7` | Ambiguous writes: a write that produced no response becomes `outcome_unknown` with `retryable: false` stated explicitly, never `failed` | 2026-09-13 | see `git log -- packages/core/src/client.ts` |
| `CORE-6` | Rate limits: `Retry-After` in both its forms and `X-RateLimit-Reset` beat our backoff; beyond 30 s a structured `rate_limited` comes back instead of a blocked caller | 2026-09-13 | see `git log -- packages/core/src/retry.ts` |
| `CORE-5` | Retry engine: one retry by default, reads only, full jitter over `[0, min(cap, base·2^n))`, deterministic under an injected `random` | 2026-09-13 | see `git log -- packages/core/src/retry.ts` |
| `CORE-4` | Error normalization: HTTP status and Braze's error message into the closed code list | 2026-09-13 | see `git log -- packages/core/src/retry.ts` |
| `CORE-8` | Request identity and timing: a UUID per attempt, and `attempts`, `totalDurationMs`, `retryWaitMs` on every result, all from the monotonic clock | 2026-09-13 | see `git log -- packages/core/src/client.ts` |
| `CORE-3` | Per-attempt timeout: the client composes its own `AbortController` and fires it through the injected `sleep`, so a timeout test waits for nothing. The timer is cancelled when the response arrives | 2026-09-13 | see `git log -- packages/core/src/client.ts` |
| `CORE-2` | Request construction: path parameters, query serialization, JSON body, and the refusals — an absolute URL where a path belongs, a non-https endpoint, an unsupplied placeholder | 2026-09-13 | see `git log -- packages/core/src/request.ts` |
| `CORE-1` | `BrazeClient.send` — one attempt with injected `fetch`, `sleep`, `clock`, `now`, `random` and `logger`; bearer auth; any HTTP status returned rather than classified | 2026-09-13 | see `git log -- packages/core/src/client.ts` |
| `CORE-12` | Mock Braze test kit — scripted `fetch` covering every status the brief names, invalid JSON, network failure, a connection dropped after send, and a request that hangs until aborted. Published as `brazecli-core/testing` | 2026-09-13 | see `git log -- packages/core/src/testing` |
| `OPS-1` | Repository scaffold: pnpm workspace, two packages, Biome, TypeScript strict, vitest, lefthook, CI, the three-layer core portability gate, documentation structure | 2026-09-13 | see `git log -- package.json` |
