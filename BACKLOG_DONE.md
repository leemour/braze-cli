# Closed backlog items

Where a number went when it left [`BACKLOG.md`](BACKLOG.md). One line each, newest first. Nothing
is ever removed from this file.

| Number | Task | Closed | Commit |
|---|---|---|---|
| `CORE-3` | Per-attempt timeout: the client composes its own `AbortController` and fires it through the injected `sleep`, so a timeout test waits for nothing. The timer is cancelled when the response arrives | 2026-09-13 | see `git log -- packages/core/src/client.ts` |
| `CORE-2` | Request construction: path parameters, query serialization, JSON body, and the refusals — an absolute URL where a path belongs, a non-https endpoint, an unsupplied placeholder | 2026-09-13 | see `git log -- packages/core/src/request.ts` |
| `CORE-1` | `BrazeClient.send` — one attempt with injected `fetch`, `sleep`, `clock`, `now`, `random` and `logger`; bearer auth; any HTTP status returned rather than classified | 2026-09-13 | see `git log -- packages/core/src/client.ts` |
| `CORE-12` | Mock Braze test kit — scripted `fetch` covering every status the brief names, invalid JSON, network failure, a connection dropped after send, and a request that hangs until aborted. Published as `brazecli-core/testing` | 2026-09-13 | see `git log -- packages/core/src/testing` |
| `OPS-1` | Repository scaffold: pnpm workspace, two packages, Biome, TypeScript strict, vitest, lefthook, CI, the three-layer core portability gate, documentation structure | 2026-09-13 | see `git log -- package.json` |
