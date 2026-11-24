# mudbase-cells-cli 0.2.0

## Why this release

Version 0.1.0 on npm calls a retired, project-scoped API path (under `/api/sandboxes/projects`) on `api.mudbase.dev`. That host does not serve Cells, so commands from 0.1.0 do not work. This repository already targets the Cells gateway at `https://cells-api.mudbase.dev` under `/v1/cells`. Version 0.2.0 is the first npm release built from that code. It is a new minor version because the command surface changed (see Breaking changes).

If you installed 0.1.0, upgrade:

```sh
npm install -g mudbase-cells-cli@latest
```

## Breaking changes from 0.1.0

This is not a drop-in patch. Scripts written for 0.1.0 must be updated.

- Cells are addressed by name (for example `cells get my-cell`), not by session ID. The `-p, --project` option and the `CELLS_PROJECT_ID` variable are gone.
- Removed commands: `console`, `expose`, and `snapshot`. Checkpoints are now `cells checkpoint create | list | restore`. There is no checkpoint delete command in this release.
- `cells create <name>` takes only a name and `--json`. The `--runtime-version` and `--timeout` options are gone.
- `cells exec <name> -- <command>` replaces `--workdir` with `--dir`. `--env KEY=VALUE` is repeatable.
- `cells services` has `list`, `get`, `start`, `stop`, `restart` and `logs`. `cells files` has `read`, `ls`, `write` and `rm`.

## New in this release

- `cells get <name>` and `cells delete <name>`.
- `cells usage` prints your usage and limits for the current billing period.
- `cells list` supports `--prefix`, `--max-results` and `--continuation-token`.
- `cells services restart`, `get` and `logs`.
- `cells files rm`, with `--recursive` for directories.

## Configuration

| Key | Env var | Default |
|-----|---------|---------|
| `apiKey` | `CELLS_API_KEY` | (required) |
| `apiUrl` | `CELLS_API_URL` | `https://cells-api.mudbase.dev` |

An `apiUrl` in `~/.cells/config.json` that points at the retired `api.mudbase.dev` host is ignored, with a warning on stderr. Remove that line from the config file to silence the warning.

## Packaging

The npm package now ships only the `src/` source files (without the test directory), `README.md`, `LICENSE` and `package.json`.
