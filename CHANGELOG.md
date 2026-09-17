# Changelog

Notable changes to `brazecli`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions
follow [semantic versioning](https://semver.org/spec/v2.0.0.html) — with `0.x` meaning the command
surface may still move between minor versions.

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
- One package to install. The Braze client is kept free of Node APIs inside the repository and is
  bundled into the published command at build time.
