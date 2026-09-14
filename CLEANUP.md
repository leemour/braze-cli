# Cleanup

Things that should be removed, with the reason and the date. **Nothing here is deleted during a
task** — it is recorded, presented at the end of a session, and removed in one batch after the
owner confirms.

Covers file deletions, dropped databases, Docker volumes and containers, stale branches,
worktrees, generated artifacts and temp directories — anything whose removal is not itself the
task at hand.

**Done 2026-09-14**, after the owner confirmed: seven merged branches removed local and on
origin (`feat/cat-1`…`feat/cat-6`, `fix/profile-update-one-field` — every patch verified already
in `main` with `git cherry`, since they were merged by rebase and their hashes therefore do not
appear in history), plus the two superseded plans. The run artifacts below were deliberately kept.

| What | Why | Recorded |
|---|---|---|
| `~/.local/share/brazecli/runs/2026-09-13/**` | Run artifacts from this session's live checks against production Braze. They carry no key, but they name real campaign counts and a profile. Owner's data, owner's call | 2026-09-13 |
