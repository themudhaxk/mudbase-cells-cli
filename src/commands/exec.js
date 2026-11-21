/**
 * cells exec <name> -- <command> [args...]
 *
 * Run one command in a cell and print its output. The command's exit status becomes the CLI exit status.
 * Runs are non-interactive (no TTY). Output is the response body; the exit status is the x-cells-exit-code header.
 *
 * Usage:
 *   cells exec my-cell -- python3 -c "print('hello')"
 *   cells exec my-cell --dir /home/cell/app -- ls -la
 *   cells exec my-cell --env MODE=test --env DEBUG=1 -- ./run.sh
 */

import { requireApiKey } from "../config.js"
import { execCell } from "../client.js"

function collect(value, previous) {
  return previous.concat([value])
}

export function registerExec(program) {
  program
    .command("exec <name> [command...]")
    .description("Run a command in a cell (non-interactive) and print its output")
    .option("--dir <path>", "Working directory for the command")
    .option("--env <KEY=VALUE>", "Environment variable (repeatable)", collect, [])
    .allowUnknownOption(false)
    .action(async (name, command, opts) => {
      requireApiKey()
      if (!command || command.length === 0) {
        console.error("Error: give the command to run after the cell name, for example: cells exec my-cell -- ls")
        process.exit(1)
      }

      const { output, exitCode } = await execCell(name, {
        cmd: command,
        dir: opts.dir,
        env: opts.env.length > 0 ? opts.env : undefined,
      })

      process.stdout.write(output)
      if (exitCode === null) {
        console.error("Error: the gateway did not report an exit status for this command")
        process.exitCode = 1
        return
      }
      process.exitCode = exitCode
    })
}
