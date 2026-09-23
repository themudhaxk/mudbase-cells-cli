/**
 * cells console
 *
 * Open an interactive terminal inside a running sandbox session.
 *
 * Connects to the gateway's WebSocket and bridges the local terminal's
 * stdin/stdout/resize to the session's PTY. Press Ctrl+C or Ctrl+D to
 * detach; the session keeps running unless --close is passed.
 *
 * Usage:
 *   cells console <sessionId> --project <projectId>
 *   cells console <sessionId> --project <projectId> --close    # close session on exit
 *   cells console <sessionId> --token <jwt>                    # use a pre-obtained token
 */

import { WebSocket } from "ws"
import { requireApiKey, requireProjectId, getConfig } from "../config.js"
import { getConnectToken } from "../client.js"

export function registerConsole(program) {
  program
    .command("console <sessionId>")
    .description("Open an interactive console in a running session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--token <jwt>", "Gateway JWT (skips connect-token API call if provided)")
    .option("--close", "Close the session when the console exits")
    .action(async (sessionId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      // Get a fresh gateway JWT for this session.
      let token
      let wsUrl
      try {
        if (opts.token) {
          token = opts.token
          const cfg = getConfig()
          wsUrl = `${cfg.gatewayUrl}/sessions/${sessionId}`
        } else {
          const tokenResult = await getConnectToken(projectId, sessionId)
          token = tokenResult.token
          wsUrl = tokenResult.wsUrl
        }
      } catch (err) {
        console.error(`Error getting connect token: ${err.message}`)
        process.exit(1)
      }

      console.error(`Connecting to session ${sessionId}...`)

      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      let connected = false
      let exitCode = 0

      ws.on("error", (err) => {
        console.error(`\nWebSocket error: ${err.message}`)
        process.exit(1)
      })

      ws.on("open", () => {
        connected = true
        console.error("Connected. Press Ctrl+C or Ctrl+D to detach.\n")

        // Send initial terminal size.
        if (process.stdout.isTTY) {
          const [cols, rows] = process.stdout.getWindowSize()
          sendResize(ws, cols, rows)
        }

        // Put stdin in raw mode to pass keystrokes through.
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(true)
        }
        process.stdin.resume()
        process.stdin.on("data", (chunk) => {
          // Detect Ctrl+D (0x04) as a detach signal when PTY sends it.
          // We forward it; the remote process handles it.
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "stdin",
              data: chunk.toString("base64"),
            }))
          }
        })

        // Forward terminal resize events.
        if (process.stdout.isTTY) {
          process.stdout.on("resize", () => {
            if (ws.readyState === WebSocket.OPEN) {
              const [cols, rows] = process.stdout.getWindowSize()
              sendResize(ws, cols, rows)
            }
          })
        }
      })

      ws.on("message", (data) => {
        let msg
        try {
          msg = JSON.parse(data.toString())
        } catch {
          return
        }

        if (msg.type === "stdout" && msg.data) {
          // Agent sends base64-encoded PTY output.
          const decoded = Buffer.from(msg.data, "base64")
          process.stdout.write(decoded)
        } else if (msg.type === "exit") {
          exitCode = typeof msg.code === "number" ? msg.code : 0
          ws.close()
        }
      })

      ws.on("close", (code, reason) => {
        // Restore terminal state before exiting.
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false)
        }
        process.stdin.pause()

        if (connected) {
          const reasonStr = reason ? ` (${reason.toString()})` : ""
          process.stderr.write(`\nSession disconnected${reasonStr}\n`)
        }

        process.exit(exitCode)
      })

      // Handle SIGINT (Ctrl+C) gracefully: send it through the PTY rather
      // than killing the CLI process immediately. The user can press Ctrl+C
      // twice to force-exit if the session is unresponsive.
      let sigintCount = 0
      process.on("SIGINT", () => {
        sigintCount++
        if (sigintCount === 1 && ws.readyState === WebSocket.OPEN) {
          // Forward Ctrl+C (0x03) to the PTY.
          ws.send(JSON.stringify({ type: "stdin", data: Buffer.from([0x03]).toString("base64") }))
        } else {
          // Second Ctrl+C: hard exit.
          if (process.stdin.isTTY) process.stdin.setRawMode(false)
          if (opts.close && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "close" }))
          }
          ws.close()
          process.exit(130)
        }
      })
    })
}

function sendResize(ws, cols, rows) {
  ws.send(JSON.stringify({ type: "resize", cols, rows }))
}
