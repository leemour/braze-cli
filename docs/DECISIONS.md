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

**NEED-1 · What does a terminal get by default — a table or raw JSON?**
**A table (option A).** «1 - A». A TTY gets the pretty renderer; a pipe gets JSON; `--json` and
`BRAZE_OUTPUT=json` force JSON in either case. The strict half is unchanged and is what the tests
hold: in a machine mode **stdout carries data and nothing else**, diagnostics go to stderr.
Consequence for `CLI-5`: mode selection is one function, so the whole default can be inverted in
one line if agent traffic ever makes that the better default.

**NEED-2 · Publish to npm, and under what name?**
**Publish at v1, not before, as `brazecli`.** «publish later, we can pick a similar name, help me
choose» → «let's use brazecli». Unscoped, chosen over `brazectl` and over a personal scope. The
packages are `brazecli` and `brazecli-core`; **the typed command stays `braze`**, set by the `bin`
field, so the package name is only ever seen in an install line. The GitHub repository keeps its
`braze-cli` name and URL.

⚠ **Unverified, and it only surfaces at the first publish:** npm refuses a new name that differs
from an existing one by punctuation alone, and `brazecli` is `braze-cli` without the hyphen. A 404
from the registry means nothing is published there, not that a publish would be accepted — the
check runs registry-side on the `PUT`. Nothing is lost by finding out at v1: renaming a package
that has never been published is a one-line change. `OPS-2` carries it. `braze-cli` is not a free name going spare: it is a live
package, `braze-cli@0.4.1`, published 2026-08-03 from
[github.com/vanducng/braze-cli](https://github.com/vanducng/braze-cli) — and almost certainly the
"existing braze-cli" that [`REQUIREMENTS.md`](REQUIREMENTS.md) §69 says to take ideas from
(`FIND-5`). Nothing is published until v1; `OPS-2` carries the work.

**NEED-5 · Which Braze cluster?**
**`https://rest.fra-01.braze.eu`.** The owner read it from the dashboard. Measured, not assumed:
the same key answers `403 Access Denied` there and `401 Invalid API key` on `iad-01`, and per
[Braze's error documentation](https://www.braze.com/docs/api/errors/) a 403 means the key **is**
recognised. ⚠ `blinkist-job-system/.env.development` says `iad-01` and is stale; the same repo's
`scripts/find_braze_users_without_email.rb:50` defaults to `fra-01` and was right all along. **A
value in someone's `.env` is their local setting, not a fact about the system.**

**NEED-6 · Should a profile be able to refuse writes outright?**
**Yes.** «да, пока разрабатываем, давай сделаем readonly режим». `readOnly: true` on a profile
refuses every write **before** `--confirm` is considered — `--confirm` guards against a mistyped
command, this guards against a correct command aimed at the wrong environment. Dry runs are still
allowed, deliberately: that is the tool you want most when a profile is locked down. The
production profile carries it.

**NEED-7 · A separate staging profile before any live check?**
**Not for now.** «3 - пока не заводи staging». Live checks are read-only against production
instead, and only when the owner says so.

**NEED-8 · Rotate the key after `SEC-1`?**
**Done by the owner** — the leaked key was deleted in Braze, which also confirmed why it was
being refused: it no longer existed.

**NEED-11 · Which permissions should the development key carry?**
**Read-only, and read-only across the board.** The owner issued a key with the full read set. Nine
read endpoints answer 200: campaigns, canvas and segments list; catalogs; sessions and DAU data
series; purchases product list; email templates; content blocks. Two things this rules out for a
development key, and they stay ruled out: `users.export.*` returns customer profiles, and the
email endpoints return addresses.

**NEED-3 · Are run directories ever deleted automatically?**
**No (option A).** «3 - A». Nothing expires on a timer. A run's `records.csv` is the only record
that an operation happened, and losing it silently is worse than the disk it costs. A
`braze runs cleanup` with an explicit retention setting stays in Phase 4 as `BULK-10`, opt-in
rather than default.
