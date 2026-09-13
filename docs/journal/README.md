# Session journal

The trail of a working day: what was asked, what was found, what was decided. It is **grepped by
number, never read end to end**, and it is deleted after a week — once harvested.

One file per session: `YYYY-MM-DD-<topic>.md`, started from [`_TEMPLATE.md`](_TEMPLATE.md). Four
sections, always all four, always in this order: tasks, the owner's questions, findings, questions
for the owner.

## Taking a number

Never by eye. The counter is atomic and shared across every worktree of this repository.

```sh
docs/journal/note.sh FIND "What was found" <<'END'
Body: what is wrong, where — path:line — and what it costs. Separate what you saw from
what you inferred.
END
```

`note.sh` allocates the number **and writes the entry in one operation**, so "took a number and
forgot to write it down" stops being a state that can happen. It routes by prefix: `TASK` to §1,
`ASK` to §2, `NEED` to §4, everything else to §3.

`next-id.sh <PREFIX>` allocates a number without writing anything. Use it only when you are
writing the entry by hand in the same breath.

Prefixes: `TASK` · `ASK` · `NEED` · `FIND` · `BUG` · `SEC` · `PERF` · `UX` · `IDEA` · `RISK` ·
`DEBT`. Nothing invented.

## Rules

- **Write the entry when you find the thing, not at the end.** A session that stops unexpectedly
  never reaches its summary, and a number that appeared in a reply but not in the journal is
  exactly the failure this exists to prevent.
- **Never rewrite it to read better.** Append. A claim that turns out to be false is corrected in
  place, marked as a correction, with the wrong claim left visible.
- **It duplicates nothing.** Real work goes to [`../../BACKLOG.md`](../../BACKLOG.md), an owner's
  ruling to [`../DECISIONS.md`](../DECISIONS.md), a deletion to
  [`../../CLEANUP.md`](../../CLEANUP.md). The journal keeps the trail, never a second copy.

## Before a journal is deleted

Harvest it: `NEED-nn` to [`../DECISIONS.md`](../DECISIONS.md) under the same number; a finding
that is still true to the backlog or to [`../ARCHITECTURE.md`](../ARCHITECTURE.md); everything
else leaves with the file and stays in git history.
