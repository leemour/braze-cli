# spec/

The committed snapshot of Braze's API collection. **Still empty — `CAT-2` puts the file here.**

`braze.postman.json` arrives through `pnpm spec:sync`, an explicit dev-time step and never
something the CLI does at startup. The point is that a change on Braze's side shows up as a
reviewable Git diff instead of silently changing the behaviour of an installed CLI.

**The source is settled** (2026-09-14, `NEED-13` in [`../docs/DECISIONS.md`](../docs/DECISIONS.md)):

```text
https://documenter.getpostman.com/api/collections/4689407/SVYrsdsG
```

This is the collection behind the page [Braze's own documentation links
to](https://www.braze.com/docs/api/postman_collection). It answers `200` with the full collection
as JSON, with no Postman account and no token: 99 requests, 32 folders, schema v2.0.0. Three
consecutive downloads were byte-identical, so a diff here means Braze changed something.

⚠ The address is Postman's internal API rather than a published one and may move without notice
(`RISK-2`). That is survivable — the snapshot in this directory is what ships, so a dead address
stops `pnpm spec:sync` and leaves the installed CLI untouched. It does mean `spec:sync` must check
that what it received is a collection before overwriting anything here; writing an HTML error page
into this directory is the one failure that would actually hurt.

The snapshot carries its provenance alongside it: source URL, sync timestamp, collection id and a
sha256 of the file.
