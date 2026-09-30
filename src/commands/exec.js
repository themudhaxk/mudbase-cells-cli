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
 *   cells exec <sessionId> --project <projectId> --timeout 60 -- npm install
 *
 * --timeout is in seconds (default: 300, i.e. 5 minutes). Use a lower value
 * for quick commands; increase it for long-running builds or installs.
 */

import { requireApiKey, requireProjectId, getConfig } from "../config.js"

/**
 * Parse a single SSE data line from the exec stream.
 *
 * The exec endpoint uses a simple prefixed-data format (no named events):
 *   data: stdout:<text>
 *   data: stderr:<text>
 *   data: exit:<code>
 *
 * Comment lines (": keepalive") and lines without a "data: " prefix are
 * not handled here; the caller filters them before calling this function.
 *
 * Returns a parsed result object, or null when the line carries no exec data.
 *
 * @param {string} line - A single trimmed SSE line, after filtering out comments.
 * @returns {{ type: "stdout"|"stderr"|"exit", text?: string, code?: number } | null}
 */
export function parseSseLine(line) {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6)
  if (data.startsWith("stdout:")) return { type: "stdout", text: data.slice(7) }
  if (data.startsWith("stderr:")) return { type: "stderr", text: data.slice(7) }
  if (data.startsWith("exit:")) {
    const code = parseInt(data.slice(5), 10)
    return { type: "exit", code: Number.isFinite(code) ? code : 1 }
  }
  return null
}

/**
 * Map a quota-related HTTP status code to a plain, actionable error message.
 * Returns null for status codes that do not represent quota errors.
 *
 * @param {number} status
 * @returns {string | null}
 */
export function quotaErrorMessage(status) {
  if (status === 402) {
    return "Monthly sandbox allowance reached. Upgrade your plan at cells.mudbase.dev."
  }
  if (status === 429) {
    return "Concurrent session limit reached. Wait for an active session to end or upgrade your plan."
  }
  return null
}

export function registerExec(program) {
  program
    .command("exec <sessionId>")
    .description("Execute a command inside a running session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option(
      "--timeout <seconds>",
      "Command timeout in seconds, 30 to 300 (default: 300)",
      "300",
    )
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

      const timeoutSeconds = parseInt(opts.timeout, 10)
      if (isNaN(timeoutSeconds) || timeoutSeconds < 30) {
        console.error("Error: --timeout must be >= 30 seconds")
        process.exit(1)
      }
      const timeoutMs = timeoutSeconds * 1000

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
        const quota = quotaErrorMessage(res.status)
        if (quota) {
          console.error(`Error: ${quota}`)
          process.exit(1)
        }
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
              // Keepalive comment: ": keepalive" or any line starting with ":".
              if (line.startsWith(":")) continue

              const parsed = parseSseLine(line)
              if (!parsed) continue

              if (parsed.type === "stdout") {
                process.stdout.write(parsed.text + "\n")
              } else if (parsed.type === "stderr") {
                process.stderr.write(parsed.text + "\n")
              } else if (parsed.type === "exit") {
                exitCode = parsed.code ?? 0
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
