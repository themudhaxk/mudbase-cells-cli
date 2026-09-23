/**
 * cells exec
 *
 * Execute a command inside a running sandbox session.
 *
 * The command runs as a subprocess (not via the PTY/REPL), so arbitrary
 * shell commands work regardless of the session's runtime language.
 * Output is streamed via SSE from the gateway's exec proxy.
 *
 * Usage:
 *   cells exec <sessionId> --project <projectId> -- python -c "print('hello')"
 *   cells exec <sessionId> --project <projectId> -- bash -c "ls /workspace"
 *   cells exec <sessionId> --project <projectId> --token <jwt> -- <cmd>
 *   cells exec <sessionId> --project <projectId> --timeout 10000 -- <cmd>
 */

import { requireApiKey, requireProjectId, getConfig } from "../config.js"
import { getConnectToken } from "../client.js"

export function registerExec(program) {
  program
    .command("exec <sessionId>")
    .description("Execute a command inside a running session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--token <jwt>", "Gateway JWT (skips connect-token API call if provided)")
    .option("--timeout <ms>", "Command timeout in milliseconds (default: 30000)", "30000")
    .option("--workdir <path>", "Working directory inside the cell", "/workspace")
    .allowUnknownOption()
    .action(async (sessionId, opts, cmd) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      // Everything after -- is the command to run.
      const args = cmd.args.slice(cmd.args.indexOf(sessionId) + 1)
      // Remove flags that belong to this command, not the target command.
      // commander puts parsed opts aside; the raw -- args are in cmd.args after the double-dash.
      // A simpler approach: take process.argv after the first -- separator.
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

      // Get a fresh gateway token for this session.
      let token = opts.token
      let gatewayBase
      try {
        if (!token) {
          const tokenResult = await getConnectToken(projectId, sessionId)
          token = tokenResult.token
          // The wsUrl is wss://..., we need https:// for the exec HTTP endpoint.
          const wsUrl = tokenResult.wsUrl
          gatewayBase = wsUrl.replace(/^wss?:\/\//, "https://").replace(/\/sessions\/.*$/, "")
        } else {
          const cfg = getConfig()
          gatewayBase = cfg.gatewayUrl.replace(/^wss?:\/\//, "https://")
        }
      } catch (err) {
        console.error(`Error getting connect token: ${err.message}`)
        process.exit(1)
      }

      const execUrl = `${gatewayBase}/sessions/${sessionId}/exec`

      let res
      try {
        res = await fetch(execUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            cmd: execCmd,
            timeoutMs,
            workingDir: opts.workdir,
          }),
        })
      } catch (err) {
        console.error(`Error: network failure reaching gateway: ${err.message}`)
        process.exit(1)
      }

      if (!res.ok) {
        let errText
        try { errText = await res.text() } catch { errText = String(res.status) }
        console.error(`Error: gateway returned ${res.status}: ${errText}`)
        process.exit(1)
      }

      // Stream SSE output from the gateway.
      //
      // The agent's exec handler (port 8766) uses named SSE events:
      //   event: stdout\ndata: {"data":"<base64>"}\n\n
      //   event: exit\ndata: {"code":N,"error":"..."}\n\n
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

          // Process SSE events. Events are separated by blank lines (\n\n).
          // Each event may have "event: <type>" and "data: <json>" lines.
          const parts = buffer.split("\n\n")
          // Keep the last (possibly incomplete) part in the buffer.
          buffer = parts.pop() || ""

          for (const eventBlock of parts) {
            const lines = eventBlock.split("\n")
            let eventType = ""
            let dataLine = ""

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                eventType = line.slice(7).trim()
              } else if (line.startsWith("data: ")) {
                dataLine = line.slice(6).trim()
              }
            }

            if (!dataLine) continue

            let frame
            try {
              frame = JSON.parse(dataLine)
            } catch {
              continue
            }

            if (eventType === "stdout" && frame.data) {
              // Agent sends base64-encoded combined stdout+stderr.
              const decoded = Buffer.from(frame.data, "base64")
              process.stdout.write(decoded)
            } else if (eventType === "exit") {
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
