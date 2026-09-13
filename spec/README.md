# spec/

The committed snapshot of Braze's API collection. **Empty until `CAT-1` and `CAT-2` land.**

`braze.postman.json` will arrive here through `pnpm spec:sync` — an explicit, dev-time step, never
something the CLI does at startup. The point is that a change on Braze's side shows up as a
reviewable Git diff instead of silently changing the behaviour of an installed CLI.

⚠ **Whether the official collection can be exported by a script is not yet established.** Every
guessed source URL returned 404 on 2026-09-13 — `RISK-1` in
[`../docs/journal/2026-09-13-repo-setup.md`](../docs/journal/2026-09-13-repo-setup.md). `CAT-1`
probes the sources and picks one before anything else in Phase 2 starts.

The snapshot carries its provenance alongside it: source URL, sync timestamp, collection id and a
sha256 of the file.
