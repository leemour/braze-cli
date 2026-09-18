# Changelog

Notable changes to `@leemour/brazecli`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions
follow [semantic versioning](https://semver.org/spec/v2.0.0.html) — with `0.x` meaning the command
surface may still move between minor versions.

## 0.1.1 — 2026-09-18

Both of these surfaced the first time the package was installed from the registry rather than
run out of its own build directory.

### Fixed

- `braze profile add`, `profile list` and `profile remove` printed raw JSON to a terminal and
  ignored `--output pretty`. They now render a table like every other command. The JSON that
  `--json` and a pipe produce is unchanged.

### Removed

- `defaultProfile` in the config file. Nothing had read it since profiles stopped having a
  default: a command without a profile named still fails, and asks for one. It was printed by
  `profile list`, where it read as a statement that some workspace was the default. A config
  that still carries the field is fine — it is ignored, and dropped the next time the file is
  written.

## 0.1.0 — 2026-09-17

The first published version. Everything below already existed; this is the release that makes it
installable.

### Added

- `braze` — profiles, `braze api`, 95 typed commands generated from Braze's collection,
  `braze schema`, `braze commands`, `braze runs`.
- Bulk runs: `--records` streams a JSONL or CSV file, batches it to Braze's limits under a bounded
  memory ceiling, and writes one audit row per record.
- `braze skill install` — writes the agent skill into Claude Code, Codex or Hermes.
- Every run leaves `run.json`, `events.jsonl` and, for a bulk run, `records.csv`.
- Published as `@leemour/brazecli`: npm refused the unscoped `brazecli` as too similar to an
  unrelated `braze-cli`. The command is `braze` either way.
- One package to install. The Braze client is kept free of Node APIs inside the repository and is
  bundled into the published command at build time.
