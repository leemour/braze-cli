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
