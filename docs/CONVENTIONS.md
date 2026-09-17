# Conventions

How code and documents are written here. Short on purpose — the linter is the authority on
formatting, and this file only covers what a linter cannot say.

## Code

**The linter decides formatting.** `pnpm lint` (Biome) settles indentation, quotes, semicolons,
line width and import order. Do not argue with it and do not hand-format around it. For the record:
2-space indent, double quotes, no semicolons, 120 columns.

**TypeScript, strict, and no `any`.** `noUncheckedIndexedAccess` is on, so an index access is
`T | undefined` and you have to handle it. `noExplicitAny` is an error, not a warning.

**Functional in the small, classes where identity matters.** `BrazeClient` and `BrazeError` are
classes because they carry identity and state; everything else is a function taking its inputs.

**Comments are sparse and say *why*.** A comment earns its place by recording a decision, warning
about a trap, or naming a constraint that is invisible locally. Never narrate a change, never leave
commented-out alternatives. If it would be obvious to a competent reader of TypeScript, delete it.

**Naming follows the Braze domain.** `UsersTrackOperation`, not `UserTrackHandlerFactory`. Braze's
own field names (`external_id`, `braze_id`, `user_alias`) survive into our types unchanged — a
renamed field is a field you have to map back every time you read the Braze docs.

**Core takes its environment as arguments.** If a function in `packages/core` needs to know
anything about the machine it runs on, it takes it as a parameter. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) §2.

**Never log a credential, and never pass one to a logger "because it's redacted".** Redaction is
the second line of defence, not the first.

**Report honestly.** If a test failed, show the output. If something could not be verified, say
which thing and why.

## Documents

The point is that six weeks from now, a person or an agent with no memory of the work can open a
doc and act on it **without reading the code first, and without being misled**. A doc that is
merely incomplete costs some time; a doc that is confidently stale costs a wrong decision.

**Say what has never been verified, at the top.** Every doc here opens with a status line naming
what is built, what is measured and what rests on assumption. This costs one paragraph and is the
difference between a doc you can act on and one you have to audit.

**Separate what you saw from what you inferred.** Something you ran gets a command and its output.
Something you read in documentation is "the docs describe X" — reading docs is not verification.

**Anchor every claim.** `path/file.ts:123` for our code, a URL for anything external. A claim
without an anchor is an opinion.

**Correct in place; never append.** A doc where the truth lives in a note at the bottom is a doc
that lies at the top. Rewrite the wrong sentence. If the wrong version circulated, mark the fix —
do not hide it.

**One fact, one home.** A decision lives in [`DECISIONS.md`](DECISIONS.md); a task lives in
[`BACKLOG.md`](BACKLOG.md); something to delete lives in `docs_ai/CLEANUP.md`;
a plan lives in `docs_ai/plans/`. Everywhere else links to it. Two copies of a fact drift, and
the reader cannot tell which is current.

**Write the trap, not the rule.** "Call `flush` before exit" is weaker than "SIGINT during a bulk
run aborts the CSV mid-row unless `flush` runs first, and a half-written row reads as a successful
submission." The failure mode is what the reader needs to recognise.

**No inventories, no archaeology, no placeholders.** A table of every class ages instantly. How a
name was chosen is not useful; what it *is*, is. `<your-app-id>` gets read as a literal — paste a
real value from a real run.

**Leave a section out rather than filling it with placeholder prose.** An empty heading is honest;
invented content is not.

**A command you hand someone is a snapshot, not a template.** Never put a placeholder inside a
runnable command — `--endpoint https://rest.XXX.braze.YYY` was pasted verbatim into a real config
(`UX-1`), and a command given before a fact was settled was re-run after it changed, silently
reverting the fix. Either the real value goes in, or the value is asked for as a plain question
first. When the facts move, reissue the command rather than trusting that nobody will run the old
one.

**English in committed documents.** The session journal is Russian, because it is the owner's own
trail. Do not mix languages inside one file.
