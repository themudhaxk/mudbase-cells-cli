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
 * --timeout is in seconds (default: 300, i.e. 5 minutes). The server accepts
 * up to 300 seconds per exec request. Use a lower value for commands you
 * expect to finish quickly; increase it for long-running builds or installs.
 */

import { requireApiKey, requireProjectId, getConfig } from "../config.js"

/**
 * Parse one SSE event block (the text between two blank lines).
 *
 * SSE comment lines (starting with ":") are keepalive frames sent by the
 * server to prevent edge-proxy timeouts. They carry no data and are ignored.
 *
 * Returns null when the block carries no data payload (e.g. a keepalive block).
 * Otherwise returns { eventType, dataLine }.
 *
 * @param {string} block - Single SSE event block, without the trailing "\n\n".
 * @returns {{ eventType: string, dataLine: string } | null}
 */
export function parseSseBlock(block) {
  const lines = block.split("\n")
  let eventType = ""
  let dataLine = ""

  for (const line of lines) {
    if (line === ":" || line.startsWith(": ")) {
      // SSE comment (keepalive). Skip.
      continue
    }
    if (line.startsWith("event: ")) {
      eventType = line.slice(7).trim()
    } else if (line.startsWith("data: ")) {
      dataLine = line.slice(6).trim()
    }
  }

  if (!dataLine) return null
  return { eventType, dataLine }
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
      // The API proxies the gateway's SSE format:
      //   event: stdout\ndata: {"data":"<base64>"}\n\n
      //   event: exit\ndata: {"code":N,"error":"..."}\n\n
      //
      // The server also sends keepalive comments (": keepalive\n\n") every 15 s
      // to prevent the edge proxy from closing idle SSE connections.
      // parseSseBlock() ignores those; only named events with a data line are
      // processed.
      //
      // Note: the agent buffers stdout/stderr until the command exits and then
      // sends one stdout event followed by an exit event. It does not stream
      // individual lines mid-execution.
      let exitCode = 0

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // SSE events are separated by blank lines (\n\n).
          const parts = buffer.split("\n\n")
          // Keep the last (possibly incomplete) part in the buffer.
          buffer = parts.pop() || ""

          for (const eventBlock of parts) {
            const parsed = parseSseBlock(eventBlock)
            if (!parsed) continue

            let frame
            try {
              frame = JSON.parse(parsed.dataLine)
            } catch {
              continue
            }

            if (parsed.eventType === "stdout" && frame.data) {
              // Agent sends base64-encoded combined stdout+stderr.
              const decoded = Buffer.from(frame.data, "base64")
              process.stdout.write(decoded)
            } else if (parsed.eventType === "exit") {
              exitCode = typeof frame.code === "number" ? frame.code : 0
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
