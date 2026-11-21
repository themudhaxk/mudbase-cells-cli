# Mudbase Cells CLI

Command-line interface for Mudbase Cells: Linux environments with a persistent filesystem, exec, services and checkpoints. The CLI talks to the Cells gateway (`https://cells-api.mudbase.dev`) under `/v1/cells`.

## Requirements

- Node.js 20 or later

## Install

### Global install

```sh
npm install -g mudbase-cells-cli
```

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

Exec is non-interactive: the command's output is printed and the CLI exits with the command's exit status. Put `--` before the command so its own flags are not read as CLI options.

### Files

```sh
cells files read my-cell notes.txt --working-dir /home/cell
cells files ls my-cell /home/cell --json
cells files write my-cell /home/cell/app.py --working-dir /home/cell --from ./app.py --mkdir
echo hello | cells files write my-cell /home/cell/hello.txt --working-dir /home/cell
cells files rm my-cell /home/cell/tmp --working-dir /home/cell --recursive
```

Relative paths resolve from `--working-dir`.

### Checkpoints

A checkpoint saves a cell's state so it can be restored later.

```sh
cells checkpoint create my-cell --comment "before-install"
cells checkpoint list my-cell
cells checkpoint restore my-cell <checkpointId>
```

Create and restore stream progress, printed as one JSON line per event. A line with `"type": "error"` makes the command exit with status 1.

### Services

A service is a long-running process inside a cell, such as a web server.

```sh
cells services list my-cell
cells services get my-cell web
cells services start my-cell web --duration 3600
cells services logs my-cell web --lines 100
cells services stop my-cell web
cells services restart my-cell web
```

## Errors

| Status | Meaning |
|--------|---------|
| 401 | The key is missing or not recognised. Check that it starts with `cells_`. |
| 403 | A plan allowance is used up. The message names the limit and includes an upgrade link when the gateway sends one. |
| 404 | The cell, checkpoint or service does not exist. |
| 429 | The concurrent cell limit or a rate limit is reached. The message shows the retry delay. |

## Known limitations

- There is no interactive terminal (console) command and no public port command in this version. The gateway does not offer a terminal or port-exposure route yet. Use `cells exec` for commands.
- Exec output is read as text, so binary output is not reproduced byte for byte. Use `cells files read` for files.
