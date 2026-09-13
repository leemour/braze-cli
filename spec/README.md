# spec/

The committed snapshot of Braze's API collection, and where every generated operation comes from.

| File | What it is |
|---|---|
| `braze.postman.json` | Braze's collection, reformatted for a readable diff. 99 requests in 32 folders |
| `provenance.json` | where it came from, when, and two hashes |

**Nothing here is fetched at runtime.** The snapshot ships with the CLI, so a change on Braze's
side arrives as a reviewable Git diff instead of silently changing the behaviour of an installed
CLI (`REQUIREMENTS.md` §6–§8).

## Updating it

```sh
pnpm spec:sync      # fetch, validate, and write only if something changed
pnpm spec:check     # fail if the snapshot is behind; writes nothing
```

The source is settled (`NEED-13` in [`../docs/DECISIONS.md`](../docs/DECISIONS.md)):
`https://documenter.getpostman.com/api/collections/4689407/SVYrsdsG`, the collection behind the
page [Braze's own documentation links to](https://www.braze.com/docs/api/postman_collection). No
Postman account and no token.

**An unchanged sync writes nothing at all**, timestamp included. A diff in this directory
therefore always means Braze changed something, which is the only way the review is worth doing.

## Two things worth knowing before you touch this

**The snapshot is reformatted, not stored as received.** Braze serves it as one 565 KB line, and a
one-line diff tells a reviewer nothing. That is why there are two hashes: `sourceSha256` is of the
bytes as received and is what detects an upstream change; `sha256` is of the formatted file here,
so the committed artifact can be verified on its own.

**`spec:sync` refuses anything that is not a collection** — markup, invalid JSON, a body with no
Postman schema, an empty collection, folders containing no requests — and writes nothing when it
refuses. The address is Postman's internal API and may move without notice (`RISK-2`); the failure
that would actually hurt is committing an HTML error page as the catalog.

If that address ever does move, `pnpm spec:sync --from <export.json>` validates and records a
manual export instead. The snapshot's shape does not change, so nothing downstream is rewritten —
that is the fallback the phase plan kept in reserve.

**`spec:check` is not a pull request gate.** It reaches the network, and making every PR depend on
Postman's uptime would buy flakiness rather than safety. Run it deliberately. The gate that fails
CI when an operation vanishes is `catalog:check`, and it works off the committed snapshot (`CAT-5`).
