# Handoff: putting `brazecli` in front of the team

**The task: make this installable by people who will not clone it.** Today the only way in is a
clone, a build and a symlink. `OPS-2` in [`../../BACKLOG.md`](../../BACKLOG.md) is the number.

---

## 1. What this is

A command line interface for the Braze REST API, built for agents and automation first: one
deterministic JSON value on stdout, a closed list of error codes, every run leaving an audit
directory, and a bulk pipeline that streams a file of records to Braze with one truthful audit row
per record. Underneath is `brazecli-core`, a separate package that uses Web Platform APIs only.

Full description: [`../../README.md`](../../README.md). How it is built:
[`../ARCHITECTURE.md`](../ARCHITECTURE.md).

## 2. Entry points

The map is [`../HANDOFF.md`](../HANDOFF.md) — read it first and do not re-derive it. It carries the
layout, which file answers which question, the commands, and the thirteen rules that cost time when
broken.

Everything else: [`../../BACKLOG.md`](../../BACKLOG.md) (what is left),
[`../DECISIONS.md`](../DECISIONS.md) (what the owner ruled),
[`../../CLEANUP.md`](../../CLEANUP.md) (what is waiting to be removed).
[`../journal/`](../journal/) is the day-by-day trail — **optional, do not read it to get oriented.**

## 3. Read these, in this order

Five files. If you find yourself grepping the repository, this handoff failed.

| File | The question it answers |
|---|---|
| [`../DECISIONS.md`](../DECISIONS.md), `NEED-2` | What name was ruled, why unscoped, and the one thing about it nobody has verified |
| [`../../BACKLOG.md`](../../BACKLOG.md), `OPS-2` `OPS-3` `OPS-4` | What "release at v1" was scoped to include, and what was deliberately left beside it |
| [`../../packages/cli/package.json`](../../packages/cli/package.json) and [`../../packages/core/package.json`](../../packages/core/package.json) | What blocks a publish this minute: `private`, `version`, and how the CLI names its dependency on core |
| [`../../README.md`](../../README.md), "Install" | What the install instructions currently promise, and therefore what has to change the moment they stop being true |
| [`../../.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | What CI runs today, and where a release job would attach |

For the keyring question in `4.5`, one more:
[`../../packages/cli/src/auth/credentials.ts`](../../packages/cli/src/auth/credentials.ts) — how a
key is stored and what happens when the keyring is unavailable.

## 4. What will bite

Nothing in this section is findable by searching.

### 4.1 The repository is already public

So this task is about **distribution and the front door**, not about opening anything. Two things
follow: the README is read by people who have not been told what this is, and anything you add is
public the moment it is pushed.

Checked 2026-09-17: neither configured profile's API key appears anywhere in `git log --all -p`.
The UUID-shaped strings in history are Braze's own request ids from the committed Postman
collection. Re-check if history is ever rewritten.

### 4.2 The name may be refused, and only at the moment of publishing

npm rejects a new name that differs from an existing one by punctuation alone. `brazecli` is
`braze-cli` without the hyphen, and `braze-cli` is a live package by somebody else. A 404 from the
registry proves nothing: the check runs registry-side on the `PUT`. `NEED-2` accepted this
knowingly — renaming a package that has never been published is a one-line change — but **do not
plan a release window around a name nobody has tested.** Try a `--dry-run` publish early.

### 4.3 The version lives in three places, and one of them prints

`packages/cli/package.json`, `packages/core/package.json`, and
[`../../packages/cli/src/version.ts`](../../packages/cli/src/version.ts), which is a hardcoded
constant behind `braze --version` and the `User-Agent`. Bump the manifests alone and the tool
reports a version that does not exist — to the user, to Braze, and into every run file.

### 4.4 `workspace:*` is not a publishable range

`brazecli` depends on `brazecli-core` as `workspace:*`. `pnpm publish` rewrites that to a real range
on the way out; `npm publish` does not, and a package published with `workspace:*` in it installs
for nobody. Core goes first, then the CLI.

### 4.5 The keyring is a native dependency

`@napi-rs/keyring` ships a prebuilt binary per platform and architecture. It works here because the
Linux build is installed; a colleague on macOS arm64 or in a container without a session keyring is
the case nobody has run. The fallback path exists — see `credentials.ts` — but "the keyring was
unavailable and it wrote a file instead" is a first-run experience worth deciding about
deliberately rather than discovering.

### 4.6 Two generated files are gated in CI

[`../commands.md`](../commands.md) and [`../catalog-coverage.md`](../catalog-coverage.md) are
generated and checked. Never hand-edit them; run `pnpm docs:generate` after any flag change, and
`pnpm build` before `pnpm docs:check` or it compares against a stale binary.

### 4.7 The bulk pipeline may not be in `main` yet

It is [PR #23](https://github.com/leemour/braze-cli/pull/23). The README's front page describes bulk
work as a reason to use this. **Check `git log --oneline -5 main` before you write a release note**:
shipping a version whose README advertises something the artifact does not contain is the one
mistake here that reaches users.

## 5. Decisions you will make — make them on purpose

These are not settled. You will settle them by acting, so settle them knowingly.

1. **What "give it to the team" means.** Three different jobs: a public npm release at v1 (`OPS-2`,
   what `NEED-2` assumed); a tarball or a git install for a handful of colleagues, which needs no
   name and no version policy; or a private registry, which needs auth wired into CI. **Ask before
   building** — the work barely overlaps.
2. **The version number.** `NEED-2` says v1 and "not before". If the answer to (1) is anything other
   than a public release, `0.x` costs nothing and promises nothing.
3. **Publishing by hand or by workflow.** CI has no release job and no npm token. A first publish by
   hand is defensible; a second one by hand is how versions drift.
4. **Whether the README's audience changes.** It currently speaks to somebody following the build.
   A team front door answers "what do I type first" in the first screen.

## 6. Do not read, do not touch

- **`spec/`** and [`../../packages/core/src/operations/generated.ts`](../../packages/core/src/operations/generated.ts) — generated from Braze's collection; changing them by hand breaks `pnpm catalog:check`.
- **[`../commands.md`](../commands.md)**, **[`../catalog-coverage.md`](../catalog-coverage.md)** — generated, see `4.6`.
- **[`../journal/`](../journal/)** — the trail, not the state. Grepped by number when something needs explaining, never read for orientation.
- **The phase plans in this directory** — closed work, listed in [`../../CLEANUP.md`](../../CLEANUP.md) for deletion.
- **`packages/core`'s dependencies** — nothing Node-shaped may enter it, and three gates enforce that. A release task has no reason to go near it.

## 7. How to check you are done

```sh
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm portability:core && pnpm smoke:bun && pnpm docs:check
```

All eight must pass; CI runs the same set on every pull request.

Then the thing this task is actually for — a machine that is not this one:

```sh
pnpm --filter brazecli-core publish --dry-run
pnpm --filter brazecli publish --dry-run     # inspect the file list and the rewritten dependency

npm pack --workspace packages/cli            # then install the tarball somewhere clean
braze --version                              # must match what you published, not 0.0.0
braze profile list                           # must work with no config present
```
