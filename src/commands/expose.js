/**
 * cells expose
 *
 * Expose an internal port so the session is reachable from the internet,
 * then poll until the preview URL returns HTTP 200 (or timeout).
 *
 * After a session starts or a service is launched, the preview URL may
 * return HTTP 502 for 10+ seconds while the container warms up. This
 * command handles that warm-up window: it polls the URL every 2 seconds
 * until it gets HTTP 200 or the --readiness-timeout is exceeded.
 *
 * Usage:
 *   cells expose <sessionId> <port> --project <projectId>
 *   cells expose <sessionId> <port> --project <projectId> --access token-gated
 *   cells expose <sessionId> <port> --project <projectId> --readiness-timeout 90
 *   cells expose <sessionId> <port> --project <projectId> --no-wait
 */

import { requireApiKey, requireProjectId } from "../config.js"
import { exposePort } from "../client.js"
import { quotaErrorMessage } from "./exec.js"

const POLL_INTERVAL_MS = 2000
const DEFAULT_READINESS_TIMEOUT_S = 60

/**
 * Poll a URL until it returns HTTP 200, or until timeoutMs is exceeded.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, statusCode: number}>}
 */
async function pollUntilReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) })
      if (res.ok) return { ok: true, statusCode: res.status }
    } catch {
      // Network error or timeout: keep retrying.
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, remaining)))
  }

  return { ok: false, statusCode: 0 }
}

export function registerExpose(program) {
  program
    .command("expose <sessionId> <port>")
    .description("Expose a port and print the public preview URL, waiting for readiness")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option(
      "--access <mode>",
      "Access control: 'public' (default) or 'token-gated'",
      "public",
    )
    .option(
      "--readiness-timeout <seconds>",
      `Seconds to wait for the preview URL to return HTTP 200 (default: ${DEFAULT_READINESS_TIMEOUT_S})`,
      String(DEFAULT_READINESS_TIMEOUT_S),
    )
    .option(
      "--no-wait",
      "Print the URL immediately without polling for readiness",
    )
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, portArg, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      const port = parseInt(portArg, 10)
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error("Error: port must be an integer between 1 and 65535")
        process.exit(1)
      }

      if (!["public", "token-gated"].includes(opts.access)) {
        console.error("Error: --access must be 'public' or 'token-gated'")
        process.exit(1)
      }

      let result
      try {
        result = await exposePort(projectId, sessionId, port, opts.access)
      } catch (err) {
        const quota = quotaErrorMessage(err.status)
        if (quota) {
          console.error(`Error: ${quota}`)
          process.exit(1)
        }
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      const publicUrl = result.publicUrl
      console.log(`Port exposed: ${port}`)
      console.log(`  URL: ${publicUrl}`)
      if (result.portToken) {
        console.log(`  Token: ${result.portToken}`)
        console.log(`  (Pass as: Authorization: Bearer ${result.portToken})`)
      }

      if (opts.wait === false) {
        return
      }

      // Poll until the URL returns 200. The sandbox agent needs 10+ seconds
      // to fully initialize after start; 502s during this window are expected.
      const readinessTimeout = parseInt(opts.readinessTimeout, 10)
      if (isNaN(readinessTimeout) || readinessTimeout < 1) {
        console.error("Error: --readiness-timeout must be >= 1 second")
        process.exit(1)
      }

      process.stderr.write(`Waiting for ${publicUrl} to become ready`)
      const { ok, statusCode } = await pollUntilReady(publicUrl, readinessTimeout * 1000)
      process.stderr.write("\n")

      if (ok) {
        console.log(`Ready (HTTP 200)`)
      } else {
        console.error(
          `Warning: URL did not return HTTP 200 within ${readinessTimeout}s ` +
          `(last status: ${statusCode || "no response"}). ` +
          `The session may still be warming up; try the URL manually in a moment.`
        )
        process.exit(1)
      }
    })
}
