---
description: Write the handoff for an open thread — the file the next agent starts editing code from, instead of searching
argument-hint: <topic or backlog number, e.g. CORE-5 or "the retry engine">
allowed-tools: Bash(git:*), Bash(rg:*), Bash(grep:*), Bash(sed:*), Bash(awk:*), Bash(ls:*), Bash(wc:*), Bash(test:*), Bash(pnpm:*), Read, Write, Edit, Glob, Grep
---

Topic: **$ARGUMENTS**

Branch: !`git rev-parse --abbrev-ref HEAD` · head: !`git rev-parse --short HEAD`

The measure of quality is **how many tool calls the receiving agent makes before its first edit**.
Target: one (the §0 block) plus two or three files from §2.

Take the material **from this session's context**. What is not in it, ask the owner — do not grep
for it.

## Three refusals

1. **One thread, one handoff.** Three topics left means one handoff and two backlog lines. Unclear
   which thread? Ask.
2. **Nothing already in [`docs_ai/HANDOFF.md`](../../docs_ai/HANDOFF.md):** what the project is, the
   layout, the commands, the ten rules. A link with a section number, nothing more.
3. **No history.** Not "how we got here", not "what I did". Closed work is one line in §1 at most.
   The exception is an **overturned owner decision** — that lives in `docs/DECISIONS.md` and §4
   links to its `NEED-nn` with the words "this is a decision, not a defect".

## Eight sections, all of them, in this order

Title `# Handoff: <topic>`, and under it one line saying **what will be true when the work is
done**. Then the signature: date, branch, head commit, and a link to `docs_ai/HANDOFF.md`.

### §0. Cold start

One `sh` block the receiver pastes as its first call. Output ceiling: **150 lines.**

```sh
cd /home/leemour/Projects/AI/braze-cli

# 1. What arrived on main along our paths since this was written
git fetch -q origin main
git log --oneline <sha>..origin/main -- packages/core/src/retry

# 2. Owner rulings on this topic — code does not overturn them
grep -B1 -A6 'NEED-1\b' docs/DECISIONS.md

# 3. Sections of documents rather than whole files, addressed BY HEADING TEXT:
#    a section number does not survive every edit, the heading does
awk '/^## .*What will bite/,/^## .*Out of scope/' docs_ai/plans/<plan>.md

# 4. The current state of the places being edited
sed -n '30,70p' packages/core/src/retry.ts
```

Under the block, in plain text and not as a comment inside it:
**"Part 1 printed commits — read them before your first edit: this handoff was written before
them."**

### §1. What to build

Three to six lines: the **end state**, not the route to it. Then checkboxes, one per step.

### §2. What to read, in this order

A table of "File | Which question it answers" — **why to open it, not what is inside**. Ceiling:
seven rows. Name a document's section **by its heading text**, never by a number and never by line
numbers; both move on the first edit.

### §3. Where to edit

A table of "What | Where". **Full path from the repository root, with a line number, and the symbol
name beside it**: `packages/core/src/retry.ts:42` — `classifyRetry`. Abbreviations are banned; they
cost a search and they fail the check below.

### §4. What will bite

Only what **cannot be found by searching**: broken assumptions, silent failures, tool traps. One
line each, "symptom → cause". Reversed decisions go here with their `NEED-nn`.

Repository-wide traps (core takes no `process`, writes are never retried) are **not repeated** —
they are in `docs_ai/HANDOFF.md` §5. Only what is specific to this thread.

### §5. What not to read or touch

A list: dead files, vendored code, other worktrees, production.

### §6. Decisions you will make yourself

The forks the receiver will hit anyway. One line each: the fork, then
"I would: <option> — <reason in half a line>".

### §7. How to close it

The checks as copy-paste, **with the current green counts**, plus the one thing to do by hand:
what to run, what should happen. Do not restate how to set the project up — link
`docs_ai/HANDOFF.md` §4.

## Check before handing it over

```sh
H=docs_ai/plans/<file>.md
wc -l $H                      # whole file — 160 lines or fewer

grep -ohE '`[A-Za-z0-9_./@-]+\.(ts|js|mjs|json|md|sh|yml)(:[0-9]+)?`' $H \
  | tr -d '`' | cut -d: -f1 | sort -u \
  | while read -r f; do test -e "$f" || echo "MISSING: $f"; done
```

Not checkable by script:

- **Run the §0 block.** It must complete without error and stay under 150 lines of output.
- **Verify the anchors:** the symbol name must be within ±15 lines of the number. If it is not,
  fix the number, not the name.

## Where it goes

- `docs_ai/plans/YYYY-MM-DD-<topic>-handoff.md`, beside the thread's plan; link the plan, never
  restate it.
- Add `handoff: docs_ai/plans/…-handoff.md` to the item's line in `docs/BACKLOG.md`.
- The thread closes → the handoff is deleted along with the plan.

## Print in reply

The absolute path to the file, and **the ready-made request for the receiving agent** as one
quote: where it works, what to read (the handoff in full, starting at §0), and that there is
nothing to read ahead of it. Do not summarize the handoff's contents.
