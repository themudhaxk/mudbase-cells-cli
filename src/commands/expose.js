/**
 * cells expose <name> [port]
 *
 * Print a cell's preview URL and wait until it answers HTTP 200.
 *
 * A cell's preview is its own `url`, served by the gateway's preview host. The old per-port exposure model
 * is retired: `port` is accepted for command-line compatibility and ignored. Previews are served only when
 * the gateway deployment enables the preview service (off by default), so a URL that never answers is
 * reported with that likely cause rather than treated as a bug in the cell.
 *
 * Usage:
 *   cells expose my-cell
 *   cells expose my-cell --readiness-timeout 90
 *   cells expose my-cell --no-wait
 *   cells expose my-cell --json
 */

import { requireApiKey } from "../config.js"
import { getCell } from "../client.js"
import { printJson } from "../output.js"

const POLL_INTERVAL_MS = 2000
const DEFAULT_READINESS_TIMEOUT_S = 60

/**
 * Poll a URL until it returns HTTP 200, or until timeoutMs is exceeded.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, statusCode: number, error: string|null}>}
 */
async function pollUntilReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  let lastStatus = 0

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) })
      lastStatus = res.status
      lastError = null
      if (res.ok) return { ok: true, statusCode: res.status, error: null }
    } catch (err) {
      lastError = err.name === "TimeoutError" ? "request timed out" : err.message
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)))
  }

  return { ok: false, statusCode: lastStatus, error: lastError }
}

export function registerExpose(program) {
  program
    .command("expose <name> [port]")
    .description("Print a cell's preview URL and wait for it to answer HTTP 200")
    .option(
      "--readiness-timeout <seconds>",
      `Seconds to wait for the preview URL to return HTTP 200 (default: ${DEFAULT_READINESS_TIMEOUT_S})`,
      String(DEFAULT_READINESS_TIMEOUT_S),
    )
    .option("--no-wait", "Print the URL immediately without polling for readiness")
    .option("--json", "Output the result as JSON")
    .action(async (name, port, opts) => {
      requireApiKey()

      if (port !== undefined) {
        console.error("Note: per-port exposure is retired; the cell's own preview URL is used and the port is ignored.")
      }

      const cell = await getCell(name)
      const previewUrl = cell?.url
      if (!previewUrl) {
        console.error(`Error: the gateway returned no preview URL for ${name}`)
        process.exit(1)
      }

      const readinessTimeout = parseInt(opts.readinessTimeout, 10)
      if (isNaN(readinessTimeout) || readinessTimeout < 1) {
        console.error("Error: --readiness-timeout must be >= 1 second")
        process.exit(1)
      }

      if (opts.wait === false) {
        if (opts.json) printJson({ name, url: previewUrl, ready: null, statusCode: null })
        else {
          console.log(`Preview URL: ${previewUrl}`)
          console.log("Not waiting for readiness (--no-wait).")
        }
        return
      }

      process.stderr.write(`Waiting for ${previewUrl} to become ready`)
      const { ok, statusCode, error } = await pollUntilReady(previewUrl, readinessTimeout * 1000)
      process.stderr.write("\n")

      if (opts.json) {
        printJson({ name, url: previewUrl, ready: ok, statusCode: ok ? statusCode : statusCode || null, error })
      }

      if (ok) {
        if (!opts.json) {
          console.log(`Preview URL: ${previewUrl}`)
          console.log("Ready (HTTP 200)")
        }
        return
      }

      console.error(
        `Warning: ${previewUrl} did not return HTTP 200 within ${readinessTimeout}s ` +
          `(last status: ${statusCode || error || "no response"}). ` +
          "The gateway may not have the preview service enabled (it is off by default), " +
          "or the cell may still be warming up. Try the URL again in a moment."
      )
      process.exit(1)
    })
}
