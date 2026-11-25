/**
 * cells console <name>
 *
 * Open an interactive terminal inside a cell.
 *
 * Connects to the gateway's WebSocket exec route with tty=true (wss://<gateway>/v1/cells/<name>/exec).
 * The provider's socket carries a PTY: binary frames are the terminal's raw input and output, and JSON text
 * frames carry control messages (session_info, exit, and debug lines). Window size is sent as a resize
 * control frame, which the PTY applies (verified live).
 *
 * Press Ctrl+C to send an interrupt to the remote shell; press it twice to leave the console. The cell keeps
 * running after the console exits.
 *
 * Usage:
 *   cells console my-cell
 *   cells console my-cell --shell sh
 *   cells console my-cell --json-events      # print control frames for diagnosis
 */

import { WebSocket } from "ws"
import { getConfig, requireApiKey } from "../config.js"
import { wsExecUrl } from "../paths.js"

export function registerConsole(program) {
  program
    .command("console <name>")
    .description("Open an interactive terminal inside a cell")
    .option("--shell <shell>", "Shell to run in the cell (default: bash)", "bash")
    .option("--json-events", "Print the socket's control frames (session_info, exit, debug)")
    .action(async (name, opts) => {
      const apiKey = requireApiKey()
      const { apiUrl } = getConfig()

      const url = wsExecUrl(apiUrl, name, { cmd: [opts.shell, "-i"] })
      const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } })

      let opened = false
      let exitCode = 0
      let sawExit = false
      const writeControl = (value) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value))
      }
      const sendSize = () => {
        if (!process.stdout.isTTY) return
        const [cols, rows] = process.stdout.getWindowSize()
        writeControl({ type: "resize", cols, rows })
      }

      const restoreTerminal = () => {
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false)
          } catch {
            // The terminal is already gone; nothing to restore.
          }
        }
        process.stdin.pause()
      }

      ws.on("unexpected-response", (_request, response) => {
        let body = ""
        response.on("data", (chunk) => {
          if (body.length < 500) body += chunk.toString("utf8")
        })
        response.on("end", () => {
          const detail = body.trim() ? `: ${body.trim()}` : ""
          console.error(`Error: the gateway refused the console (HTTP ${response.statusCode})${detail}`)
          process.exit(1)
        })
      })

      ws.on("error", (err) => {
        restoreTerminal()
        console.error(`\nWebSocket error: ${err.message}`)
        process.exit(1)
      })

      ws.on("open", () => {
        opened = true
        console.error("Connected. Ctrl+C interrupts; press it twice to leave.\n")
        sendSize()

        if (process.stdin.isTTY) process.stdin.setRawMode(true)
        process.stdin.resume()
        process.stdin.on("data", (chunk) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
        })

        if (process.stdout.isTTY) process.stdout.on("resize", sendSize)
      })

      ws.on("message", (data, isBinary) => {
        if (isBinary) {
          process.stdout.write(data)
          return
        }
        const text = data.toString("utf8")
        let message = null
        try {
          message = JSON.parse(text)
        } catch {
          message = null
        }
        if (opts.jsonEvents) console.error(`\n[${text}]\n`)
        if (message && message.type === "exit") {
          sawExit = true
          exitCode = typeof message.exit_code === "number" ? message.exit_code : 0
          ws.close()
        }
      })

      ws.on("close", (code, reason) => {
        restoreTerminal()
        if (opened && code !== 1000 && code !== 1005) {
          const detail = reason && reason.length > 0 ? `: ${reason.toString()}` : ""
          console.error(`\nSession closed (code ${code})${detail}`)
          // A dropped session with no exit frame is a failure, not a clean exit.
          if (!sawExit) exitCode = 1
        } else if (opened) {
          process.stderr.write("\nSession ended.\n")
        }
        process.exit(exitCode)
      })

      let interrupts = 0
      process.on("SIGINT", () => {
        interrupts += 1
        if (interrupts === 1) {
          // The PTY treats a raw 0x03 byte as an interrupt, the same as a real terminal.
          if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from([0x03]))
          return
        }
        restoreTerminal()
        if (ws.readyState === WebSocket.OPEN) ws.close()
        process.exit(130)
      })
    })
}
