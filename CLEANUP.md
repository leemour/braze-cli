# Cleanup

Things that should be removed, with the reason and the date. **Nothing here is deleted during a
task** — it is recorded, presented at the end of a session, and removed in one batch after the
owner confirms.

Covers file deletions, dropped databases, Docker volumes and containers, stale branches,
worktrees, generated artifacts and temp directories — anything whose removal is not itself the
task at hand.

| What | Why | Recorded |
|---|---|---|
| `docs/plans/2026-09-13-phase-1-foundation.md` | Phase 1 landed and was verified live; a plan is deleted when its work does. Its decisions are in `DECISIONS.md`, its durable truths in `ARCHITECTURE.md`, its leftovers numbered in `BACKLOG.md`. Keep until the next agent has read the Phase 2 handoff, which refers to it for context | 2026-09-13 |
| `~/.local/share/brazecli/runs/2026-09-13/**` | Run artifacts from this session's live checks against production Braze. They carry no key, but they name real campaign counts and a profile. Owner's data, owner's call | 2026-09-13 |
| branch `feat/cat-1-collection-source` (local and on origin) | Merged into `main` by rebase in PR #1 on 2026-09-14; its eleven commits are in `main`'s history, so the branch carries nothing the default branch does not | 2026-09-14 |
| branch `feat/cat-2-spec-snapshot` (local and on origin) | Merged into `main` by rebase in PR #2 on 2026-09-14; its commits are in `main`'s history | 2026-09-14 |
| branch `feat/cat-3-normalizer` (local and on origin) | Merged into `main` by rebase in PR #3 on 2026-09-14; its commits are in `main`'s history | 2026-09-14 |
| branch `feat/cat-4-overrides` (local and on origin) | Merged into `main` by rebase in PR #4 on 2026-09-14; its commits are in `main`'s history | 2026-09-14 |
