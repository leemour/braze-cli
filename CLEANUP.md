# Cleanup

Things that should be removed, with the reason and the date. **Nothing here is deleted during a
task** — it is recorded, presented at the end of a session, and removed in one batch after the
owner confirms.

Covers file deletions, dropped databases, Docker volumes and containers, stale branches,
worktrees, generated artifacts and temp directories — anything whose removal is not itself the
task at hand.

**Done 2026-09-15**, after the owner confirmed (`NEED-36`, option B): the throwaway `sigtest` profile and its
keyring entry are gone. The two staging user profiles could not be: the key is refused `users.delete` with a 403,
so their line stays below with what it would take. Run artifacts were deliberately kept — they are the only record
of what was sent to Braze today.

**Done 2026-09-14**, after the owner confirmed: seven merged branches removed local and on
origin (`feat/cat-1`…`feat/cat-6`, `fix/profile-update-one-field` — every patch verified already
in `main` with `git cherry`, since they were merged by rebase and their hashes therefore do not
appear in history), plus the two superseded plans. The run artifacts below were deliberately kept.

| What | Why | Recorded |
|---|---|---|
| `docs/plans/2026-09-13-phase-2-catalog.md` and `2026-09-14-phase-2-handoff.md` | Phase 2 landed on 2026-09-14 — all six steps closed, 362 tests. A plan and its handoff are deleted when their work does. Keep until whoever opens Phase 3 has read them, since they carry the reasoning behind the catalog's shape; the rulings are already in `DECISIONS.md` and the leftovers numbered in `BACKLOG.md` | 2026-09-14 |
| `~/.local/share/brazecli/runs/2026-09-13/**` | Run artifacts from this session's live checks against production Braze. They carry no key, but they name real campaign counts and a profile. Owner's data, owner's call | 2026-09-13 |
| Staging Braze workspace: user profiles `brazecli-risk3-1` and `brazecli-risk3-3` | Created by the `RISK-3` measurement — one `/users/track` batch to the staging workspace to read how Braze attributes an error inside a 2xx. They carry one attribute, `brazecli_test: true`. **Removal attempted 2026-09-15 and refused: the staging key has no `users.delete` permission (403 Access Denied).** Needs that permission added in the Braze dashboard, or the two profiles deleted there by hand; then `braze --profile staging api POST /users/delete --input '{"external_ids":["brazecli-risk3-1","brazecli-risk3-3"]}' --confirm` | 2026-09-15 |
| `~/.local/share/brazecli/runs/2026-09-15/**` | Run artifacts from today's staging checks. No key in them (SEC-1 redaction), but they carry the staging workspace's campaign names and the test profiles above | 2026-09-15 |
