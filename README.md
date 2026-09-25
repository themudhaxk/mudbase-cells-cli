# Mudbase Cells CLI

Command-line interface for Mudbase Cells: cloud sandbox environments.

## Requirements

- Node.js 20 or later

## Install

### Global install from npm (once published)

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

Set your Mudbase API key in one of these ways (checked in priority order):

1. Environment variable: `export CELLS_API_KEY=sk_...`
2. Config file at `~/.cells/config.json`:

```json
{
  "apiKey": "sk_...",
  "projectId": "<your-project-id>"
}
```

All configuration options:

| Key | Env var | Default |
|-----|---------|---------|
| `apiKey` | `CELLS_API_KEY` | (required) |
| `projectId` | `CELLS_PROJECT_ID` | (optional, or pass `--project` each time) |
| `apiUrl` | `CELLS_API_URL` | `https://api.mudbase.dev` |
| `gatewayUrl` | `CELLS_GATEWAY_URL` | `wss://ws.sandbox.mudbase.dev` |

## Commands

### Create a session

```sh
cells create --project <projectId>
cells create --project <projectId> --language node --version 22
cells create --project <projectId> --timeout 600
```

Options: `--language` (python or node, default: python), `--version` (e.g. 3.12 or 22), `--timeout` (seconds, default 300), `--json`.

### List sessions

```sh
cells list --project <projectId>
cells list --project <projectId> --json
```

### Execute a command

```sh
cells exec <sessionId> --project <projectId> -- python -c "print('hello')"
cells exec <sessionId> --project <projectId> -- bash -c "ls /workspace"
cells exec <sessionId> --project <projectId> --timeout 60000 -- pip install requests
```

Options: `--timeout` (milliseconds, default 30000), `--workdir` (default `/workspace`).

Note: exec streams output via server-sent events. The command runs inside the live session as a subprocess.

### Open an interactive console

```sh
cells console <sessionId> --project <projectId>
cells console <sessionId> --project <projectId> --close
```

Opens a raw interactive terminal (PTY) attached to the running session. Press Ctrl+C twice or Ctrl+D to detach. Pass `--close` to terminate the session when you exit.

### Snapshot (checkpoint and restore)

Snapshot commands save and restore a session's filesystem state.

```sh
# Create a snapshot
cells snapshot create <sessionId> --project <projectId>
cells snapshot create <sessionId> --project <projectId> --label "before-install"

# List snapshots
cells snapshot list <sessionId> --project <projectId>

# Restore from a snapshot
cells snapshot restore <sessionId> <snapshotId> --project <projectId>
```

Note: snapshot support requires the backend version that includes the checkpoint/restore API. If the server has not yet enabled this feature, the command exits with code 2 and prints a clear message.

## Known limitations

- Interactive exec and console require an active session with a running agent. If a session has expired or the agent is unreachable, the command will fail at the connection step.
- Snapshot create and restore are wired against the documented API endpoints. They will report "not yet available" if run against a server version that has not yet deployed the checkpoint/restore feature.
