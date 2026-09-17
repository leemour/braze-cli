# brazecli

Read from and write to the [Braze](https://www.braze.com/docs/api/basics/) REST API from a terminal
or a script. Built for AI agents and automation first, and good for people second.

```sh
npx brazecli --help
npm install -g brazecli
```

The command is `braze`.

```sh
braze profile add staging --endpoint https://rest.fra-01.braze.eu
braze staging campaigns list --json
braze staging users track --records users.jsonl --records-field attributes --confirm
npx brazecli skill install        # teach Claude Code, Codex or Hermes to drive it
```

- 95 typed commands generated from Braze's own catalog, plus `braze api` for everything else
- bulk runs from a JSONL or CSV file, batched, with one audit row per record
- no default profile, `--confirm` on every write, read-only profiles, keys in the OS keyring
- `--json` gives one deterministic value on stdout and a closed list of exit codes

Needs Node 22+.

**Documentation, and the source:
[github.com/leemour/brazecli](https://github.com/leemour/brazecli).**

MIT.
