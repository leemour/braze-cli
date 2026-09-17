# brazecli — working rules

**Start with [`docs_ai/HANDOFF.md`](docs_ai/HANDOFF.md).** What this is, the layout, what to read
for which task, how to run the checks, and the rules that cost time when broken. It is short; read
it before anything else.

`docs_ai/` is the working trail — handoff, plans, session journal, cleanup list — and it is **not
in git**. A fresh clone does not have it. When it is absent, start from
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/BACKLOG.md`](docs/BACKLOG.md) instead,
and create `docs_ai/` as you go.

Then the one reference that covers what you are about to touch —
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the seams,
[`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) for how code and documents are written here.

## The constraint that shapes everything

`packages/core` must run unchanged in a Cloudflare Worker. No `node:*`, no `process`, no `Buffer`,
no config file, no terminal formatting. Anything the environment knows is **passed in as an
argument**. Three gates enforce it — `pnpm lint`, `pnpm typecheck`, `pnpm portability:core` — and
they exist because any one of them alone lets something through.

## Plan before building

For anything that is not a one-file, one-step change, **write the plan first and stop for review**:

1. Orient — read the relevant code and docs. No edits.
2. Write the plan into [`docs_ai/plans/`](docs_ai/plans/) and show it. Wait for approval.
3. Build against it, and correct the plan when reality diverges.

The plan states: the goal, the current state with `path:line` anchors, the decisions being made and
why, ordered work items, the test plan, and the open questions. Flag anything needing a product
decision instead of guessing.

A typo, a broken line, an obvious one-line bug — just fix it.

## Ask git before you fix

**A document claiming something is broken, unfinished or not started is a snapshot of someone
else's day, not a fact.** Check it with one command rather than by reading a second document:

```sh
git log -S'<string that should not be there>' -- <path>
git log --oneline -1 -- <path>
```

A discrepancy you find gets **corrected in the document that is wrong, in place**, marked as a
correction. A note appended at the bottom does not count — the next reader reads the top.

## Comments

Sparse, and only *why*. The global rule in `~/.claude/CLAUDE.md` applies and overrides what any
surrounding file looks like. No comment restating the line above it, no section banners, no
narrating the change you just made.

## Record the trail as you go

This repository keeps a [session journal](docs_ai/journal/README.md). Take numbers with
`docs_ai/journal/note.sh`, which allocates and writes in one operation, and **write the entry when
you find the thing, not at the end of the session**.

A number that appeared in a reply and is missing from the journal is precisely the failure the
journal exists to prevent.

## Deletions

**Never delete or clean up mid-task.** Append a line to
[`docs_ai/CLEANUP.md`](docs_ai/CLEANUP.md) — the path, why it should go, the date — and do the removals in one batch at the end, after the owner confirms.
This covers files, branches, worktrees, generated artifacts and temp directories.

Exception: something that *is* the task ("remove the old X"), or a file you created earlier in the
same session and no longer need.

**Never kill a process by name.** No `pkill`, no `killall`. Find the PID, confirm it is yours, kill
that PID.

## Committing

Conventional commits. Run the relevant checks before committing — at minimum `pnpm lint` and
`pnpm test`, plus `pnpm portability:core` if `packages/core` was touched. The pre-push hook runs
the typecheck and the portability gate; it is a safety net, not a substitute.

Work on a branch off `main` and open a pull request. CI gates every one. The single
exception in this repository's history is the scaffold commit itself — there was no `main`
to branch from yet.
