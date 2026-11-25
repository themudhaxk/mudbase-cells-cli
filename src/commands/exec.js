/**
 * cells exec <name> -- <command> [args...]
 *
 * Run one command in a cell and print its output. The command's exit status becomes the CLI exit status.
 * Runs are non-interactive (no TTY). Standard output goes to stdout and standard error to stderr, which the
 * gateway keeps apart in the JSON form of the answer.
 *
 * Usage:
 *   cells exec my-cell -- python3 -c "print('hello')"
 *   cells exec my-cell --dir /tmp -- ls -la
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

      const { stdout, stderr, exitCode, truncated } = await execCell(name, {
        cmd: command,
        dir: opts.dir,
        env: opts.env.length > 0 ? opts.env : undefined,
      })

      if (stdout) process.stdout.write(stdout)
      if (stderr) process.stderr.write(stderr)
      if (truncated) {
        console.error("Warning: the command output was longer than the gateway returns; it was cut.")
      }
      if (exitCode === null) {
        console.error("Error: the gateway did not report an exit status for this command")
        process.exitCode = 1
        return
      }
      process.exitCode = exitCode
    })
}
