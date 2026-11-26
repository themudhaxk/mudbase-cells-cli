# Mudbase Cells CLI

Command-line interface for Mudbase Cells: Linux environments with a persistent filesystem, exec, services and checkpoints. The CLI talks to the Cells gateway (`https://cells-api.mudbase.dev`) under `/v1/cells`.

## Requirements

- Node.js 20 or later

## Install

### Global install

Not available from npm yet. The registry still serves 0.1.0, which targets the retired API. Once the publish workflow (`.github/workflows/publish.yml`) runs, install 0.2.0 with:

```sh
npm install -g mudbase-cells-cli@0.2.0
```

Until then, use the local development install below.

### Local development install (npm link)

Clone the repo and link it globally so the `cells` binary is on your PATH.

If your global npm prefix is writable (e.g. when using nvm), the standard approach works:

```sh
git clone https://github.com/themudhaxk/mudbase-cells-cli.git
cd mudbase-cells-cli
npm install
npm link
```

If the global npm prefix is root-owned (common on Linux with system Node.js), link into your user-local bin instead:

```sh
git clone https://github.com/themudhaxk/mudbase-cells-cli.git
cd mudbase-cells-cli
npm install
# Point npm at a writable prefix for this link only:
npm config set prefix ~/.local
npm link
```

Then ensure `~/.local/bin` is on your PATH (add to `~/.bashrc` or `~/.zshrc` if needed):

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Verify:

```sh
cells --version
```

To unlink later: `npm unlink -g mudbase-cells-cli`

## Authentication

Every request sends your key as `Authorization: Bearer <key>`. Keys look like `cells_<16 hex>.<43 characters>`. Create and revoke keys in the Cells console.

Set your key in one of these ways (checked in priority order):

1. Environment variable: `export CELLS_API_KEY=cells_...`
2. Config file at `~/.cells/config.json`:

```json
{
  "apiKey": "cells_...",
  "apiUrl": "https://cells-api.mudbase.dev"
}
```

All configuration options:

| Key | Env var | Default |
|-----|---------|---------|
| `apiKey` | `CELLS_API_KEY` | (required) |
| `apiUrl` | `CELLS_API_URL` | `https://cells-api.mudbase.dev` |

`CELLS_MAX_BODY_BYTES` is read from the environment only (default 64 MiB); it is not a config-file key.

## Commands

A cell is addressed by its name, unique within your organization.

### Create a cell

```sh
cells create my-cell
cells create my-cell --json
```

### List cells

```sh
cells list
cells list --prefix dev- --max-results 20
cells list --continuation-token <token>
cells list --json
```

### Show or delete a cell

```sh
cells get my-cell
cells delete my-cell
```

### Usage

```sh
cells usage
```

Prints your usage and limits for the current billing period as JSON.

### Execute a command

```sh
cells exec my-cell -- python3 -c "print('hello')"
cells exec my-cell --dir /home/cell/app -- ls -la
cells exec my-cell --env MODE=test --env DEBUG=1 -- ./run.sh
```

Exec is non-interactive: standard output goes to stdout, standard error goes to stderr, and the CLI exits with the command's exit status. Put `--` before the command so its own flags are not read as CLI options.

### Interactive console

```sh
cells console my-cell
cells console my-cell --shell sh
cells console my-cell --json-events
```

Opens a terminal inside the cell over the gateway's WebSocket exec route. Ctrl+C interrupts the remote shell; press it twice to leave. The cell keeps running after the console exits. The default shell is `bash`; use `--shell sh` if the cell's image has no bash.

### Files

```sh
cells files read my-cell notes.txt --working-dir /tmp
cells files read my-cell app.tar.gz --working-dir /tmp --output ./app.tar.gz
cells files ls my-cell /tmp --json
cells files write my-cell app.py --working-dir /tmp --from ./app.py --mkdir
echo hello | cells files write my-cell hello.txt --working-dir /tmp
cells files rm my-cell /tmp/tmp --working-dir /tmp --recursive
```

Relative paths resolve from `--working-dir`. Content is moved as bytes in both directions, so binary files round-trip unchanged. A new cell has no `/workspace` directory; create it with `cells exec my-cell -- mkdir -p /workspace` before you use it as a working directory.

`cells files rm` refuses an empty path before any request is sent. Deleting the filesystem root with `--recursive` is refused unless you add `--yes-delete-root`. A path that resolves to `/` counts too (for example `/tmp/..`, or `.` with `--working-dir /`). The confirmed form is:

```sh
cells files rm my-cell / --recursive --yes-delete-root
```

Cell names `.` and `..` are refused on every command that takes a cell name, with an error, before any request is sent.

### Checkpoints

A checkpoint saves a cell's state so it can be restored later.

```sh
cells checkpoint create my-cell --comment "before-install"
cells checkpoint list my-cell
cells checkpoint restore my-cell <checkpointId>
```

Create and restore stream progress, printed as one `<type>: <message>` line per event (progress text is in Cells vocabulary, never raw JSON). A failed event stops the command with exit status 1 and an Error line.

### Services

A service is a long-running process inside a cell, such as a web server. Define it once, then start, stop or restart it.

```sh
cells services list my-cell
cells services define my-cell web --cmd python3 --args -m,http.server,8000 --http-port 8000
cells services get my-cell web
cells services start my-cell web --duration 5
cells services logs my-cell web --lines 100
cells services stop my-cell web
cells services restart my-cell web
```

`define` creates or updates the definition and the gateway starts it. Lifecycle calls stream progress events, printed one line each.

### Preview URL

```sh
cells expose my-cell
cells expose my-cell --readiness-timeout 90
cells expose my-cell --no-wait
```

Prints the cell's preview URL and waits for it to answer HTTP 200. The per-port exposure model is retired, so a `port` argument is accepted and ignored. Previews are served only when the gateway deployment enables the preview service, which is off by default; when the URL never answers, the command says so instead of reporting the cell as broken.

## Errors

| Status | Meaning |
|--------|---------|
| 401 | The key is missing or not recognised. Check that it starts with `cells_`. |
| 403 | A plan allowance is used up. The message names the limit and includes an upgrade link when the gateway sends one. |
| 404 | The cell, checkpoint or service does not exist. |
| 429 | The concurrent cell limit or a rate limit is reached. The message shows the retry delay. |

## Known limitations

- Exec output is a text reading of the gateway's best-effort stream, so a command that writes binary bytes to its output can lose a byte that equals a stream marker. Use `cells files read` for files.
- Exec answers are capped at 1 MiB by the gateway. Past the cap the output is cut and the exit status is unknown, so `cells exec` exits 1 even when the command succeeded.
- A response body larger than `CELLS_MAX_BODY_BYTES` (64 MiB by default) is refused with a clear error instead of being buffered.
- Progress and log output is sanitized: ANSI and OSC escape sequences, and other C0 control bytes except newline and tab, are stripped from event data and type before they reach the terminal.
- The gateway has no checkpoint delete route, so the CLI has no checkpoint delete command.
- Previews are served only when the gateway deployment enables the preview service; `cells expose` reports that state rather than hiding it.
