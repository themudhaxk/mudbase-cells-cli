/**
 * cells exec
 *
 * Execute a command inside a running sandbox session.
 *
 * The command runs as a subprocess (not via the PTY/REPL), so arbitrary
 * shell commands work regardless of the session's runtime language.
 * Output is streamed via SSE from the API's exec endpoint.
 *
 * Usage:
 *   cells exec <sessionId> --project <projectId> -- python -c "print('hello')"
 *   cells exec <sessionId> --project <projectId> -- bash -c "ls /workspace"
 *   cells exec <sessionId> --project <projectId> --timeout 10000 -- <cmd>
 */

import { requireApiKey, requireProjectId, getConfig } from "../config.js"

export function registerExec(program) {
  program
    .command("exec <sessionId>")
    .description("Execute a command inside a running session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--timeout <ms>", "Command timeout in milliseconds (default: 30000)", "30000")
    .option("--workdir <path>", "Working directory inside the cell", "/workspace")
    .allowUnknownOption()
    .action(async (sessionId, opts) => {
      const apiKey = requireApiKey()
      const projectId = requireProjectId(opts.project)

      // Everything after -- is the command to run.
      const dashDash = process.argv.indexOf("--")
      if (dashDash === -1 || dashDash >= process.argv.length - 1) {
        console.error("Usage: cells exec <sessionId> [opts] -- <command> [args...]")
        process.exit(1)
      }
      const execCmd = process.argv.slice(dashDash + 1)
      if (execCmd.length === 0) {
        console.error("Error: command required after --")
        process.exit(1)
      }

      const timeoutMs = parseInt(opts.timeout, 10)
      const { apiUrl } = getConfig()

      const execUrl = `${apiUrl}/api/sandboxes/projects/${projectId}/sessions/${sessionId}/exec`

      let res
      try {
        res = await fetch(execUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            cmd: execCmd,
            timeoutMs,
            workingDir: opts.workdir,
          }),
        })
      } catch (err) {
        console.error(`Error: network failure reaching API: ${err.message}`)
        process.exit(1)
      }

      if (!res.ok) {
        let errText
        try { errText = await res.text() } catch { errText = String(res.status) }
        console.error(`Error: API returned ${res.status}: ${errText}`)
        process.exit(1)
      }

      // Stream SSE output from the API.
      //
      // The exec endpoint returns a text/event-stream (SSE) response in the
      // simple line-prefixed format used by the sandbox gateway:
      //
      //   data: stdout:<line text>\n\n
      //   data: stderr:<line text>\n\n
      //   data: exit:<code>\n\n
      //   : keepalive\n\n   (emitted every 10 s to keep the Fly proxy alive)
      //
      // Each event boundary is a double newline. Keepalive comment lines start
      // with ":" and are ignored.
      let exitCode = 0

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Split on SSE event boundaries (double newline).
          const parts = buffer.split("\n\n")
          // Keep the last (possibly incomplete) part in the buffer.
          buffer = parts.pop() || ""

          for (const eventBlock of parts) {
            for (const rawLine of eventBlock.split("\n")) {
              const line = rawLine.trim()
              if (!line) continue

              // Keepalive comment: ": keepalive" - ignore.
              if (line.startsWith(":")) continue

              if (line.startsWith("data: ")) {
                const data = line.slice(6)
                if (data.startsWith("stdout:")) {
                  process.stdout.write(data.slice(7) + "\n")
                } else if (data.startsWith("stderr:")) {
                  process.stderr.write(data.slice(7) + "\n")
                } else if (data.startsWith("exit:")) {
                  const code = parseInt(data.slice(5), 10)
                  exitCode = Number.isFinite(code) ? code : 1
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error streaming exec output: ${err.message}`)
        process.exit(1)
      }

      process.exit(exitCode)
    })
}
