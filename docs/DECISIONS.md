# Decisions

Rulings by the owner, lifted out of the session journals. A journal is a trail of one day and is
short-lived; a decision holds until it is overturned, so it lives here.

**The `NEED-nn` number is the same one that appeared in the journal and in the reply footer.**
Plans, commits and other docs cite it. Numbers are never reused.

**How to use this file.** Found behaviour in the code or a document that looks wrong? Look here
before fixing it. A document that contradicts a line here is the thing that is wrong, not the
decision.

**An overturned decision is struck through, not deleted**, with a note saying what replaced it.

---

## 2026-09-13

**NEED-0 · Is the repository public?**
**Public.** Not a pending question — measured, not decided: `gh repo view leemour/braze-cli`
reports `"visibility": "PUBLIC"`, created 2026-09-13. This settles remaining question #1 in
[`REQUIREMENTS.md`](REQUIREMENTS.md) and has two consequences that are already acted on: committed
documents are written in English, and CI runs on every pull request because Actions minutes are
free on a public repository.

*Awaiting the owner:* `NEED-1` (default terminal output), `NEED-2` (npm publishing), `NEED-3` (run
artifact retention), written out in full in
[`journal/2026-09-13-repo-setup.md`](journal/2026-09-13-repo-setup.md) §4. They move here with
their answers.
