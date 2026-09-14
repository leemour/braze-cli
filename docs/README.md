# Documentation map

**Start with [`HANDOFF.md`](HANDOFF.md)** — what this is, how it is laid out, what to read for
which task, how to run the checks, and the thirteen rules that cost time when broken. Everything else
here is a reference opened for a specific task, not read in order.

Reading rule: [`ARCHITECTURE.md`](ARCHITECTURE.md) describes how the code behaves **now**. When a
document disagrees with the code, the code is right and the document gets corrected in place.

## Work

| File | Answers |
|---|---|
| [`REQUIREMENTS.md`](REQUIREMENTS.md) | what the owner asked for — the brief, verbatim |
| [`../BACKLOG.md`](../BACKLOG.md) | what is left to build — the single live list |
| [`../BACKLOG_DONE.md`](../BACKLOG_DONE.md) | where a number that is no longer in the backlog went |
| [`DECISIONS.md`](DECISIONS.md) | what the owner ruled, and why |
| [`plans/`](plans/) | plans and handoffs for **open** threads; deleted when the work lands |
| [`journal/`](journal/) | this week's trail — grepped by number, not read |
| [`../CLEANUP.md`](../CLEANUP.md) | what should be removed, with the reason and the date |

## Reference

| Topic | Files |
|---|---|
| How it is built, and which seams not to cross | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| How code and documents are written here | [`CONVENTIONS.md`](CONVENTIONS.md) |
| How to check it yourself | [`TESTING.md`](TESTING.md) |
| What every command takes | [`commands.md`](commands.md) — **generated**, `pnpm docs:generate` |
| How much of Braze is covered | [`catalog-coverage.md`](catalog-coverage.md) — **generated**, `pnpm catalog:generate` |

Neither generated file is ever edited by hand: `pnpm docs:check` and `pnpm catalog:check` fail CI
when one drifts from the thing it describes.

## Not written yet

These land with the code they describe, not before — an empty heading is honest, invented content
is not. Tracked as `DOC-2` in the backlog.

`authentication.md` · `configuration.md` · `bulk-runs.md` · `security.md` · `development.md`
