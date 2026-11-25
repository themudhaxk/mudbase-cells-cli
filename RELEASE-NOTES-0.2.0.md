# mudbase-cells-cli 0.2.0

## Why this release

Version 0.1.0 on npm calls a retired, project-scoped API path (under `/api/sandboxes/projects`) on `api.mudbase.dev`. That host does not serve Cells, so commands from 0.1.0 do not work. This repository already targets the Cells gateway at `https://cells-api.mudbase.dev` under `/v1/cells`. Version 0.2.0 is the first release built from that code, but it is not published to npm yet. It is a new minor version because the command surface changed (see Breaking changes).

Version 0.2.0 becomes installable once the publish workflow (`.github/workflows/publish.yml`) runs. Until then, the `@latest` tag still points at 0.1.0, which targets the retired API and does not work.

When 0.2.0 is on npm, install or upgrade with:

```sh
npm install -g mudbase-cells-cli@0.2.0
```

## Breaking changes from 0.1.0

This is not a drop-in patch. Scripts written for 0.1.0 must be updated.

- Cells are addressed by name (for example `cells get my-cell`), not by session ID. The `-p, --project` option and the `CELLS_PROJECT_ID` variable are gone.
- The `snapshot` command is now `cells checkpoint create | list | restore`. There is no checkpoint delete command in this release.
- `console` and `expose` are back, retargeted to the gateway: `console` opens a terminal over the gateway's WebSocket exec route, and `expose` prints a cell's own preview URL (the per-port model is retired).
- `cells create <name>` takes only a name and `--json`. The `--runtime-version` and `--timeout` options are gone.
- `cells exec <name> -- <command>` replaces `--workdir` with `--dir`. `--env KEY=VALUE` is repeatable.
- `cells services` has `list`, `get`, `define`, `start`, `stop`, `restart` and `logs`. `cells files` has `read`, `ls`, `write` and `rm`.

## New in this release

- `cells get <name>` and `cells delete <name>`.
- `cells usage` prints your usage and limits for the current billing period.
- `cells list` supports `--prefix`, `--max-results` and `--continuation-token`.
- `cells console <name>` opens an interactive terminal in the cell.
- `cells expose <name>` prints the cell's preview URL and waits for it to answer.
- `cells services define` sets a service's command, arguments, directory, environment and HTTP port.
- `cells services restart`, `get` and `logs`. `logs` prints the service output and event types, not the raw provider JSON (which named backend log paths).
- `cells files rm`, with `--recursive` for directories.
- `cells files read --output` saves a file, bytes unchanged; `cells files write` moves bytes too, so binary files round-trip.
- Stream output is sanitized: ANSI and OSC escapes are stripped from event data and type, a malformed frame reports only its type and byte length, a body that is not an event stream fails loudly, and a response over `CELLS_MAX_BODY_BYTES` (64 MiB by default) is refused with a clear error.

## Security note

`cells exec` sends the command arguments and every `--env KEY=VALUE` value to the gateway as URL query parameters. Do not put secrets in exec arguments or `--env` values: URLs can appear in logs along the path.

## Configuration

| Key | Env var | Default |
|-----|---------|---------|
| `apiKey` | `CELLS_API_KEY` | (required) |
| `apiUrl` | `CELLS_API_URL` | `https://cells-api.mudbase.dev` |

An `apiUrl` in `~/.cells/config.json` that points at the retired `api.mudbase.dev` host is ignored, with a warning on stderr. Remove that line from the config file to silence the warning.

## Packaging

The npm package now ships only the `src/` source files (without the test directory), `README.md`, `LICENSE` and `package.json`.
