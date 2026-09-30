/**
 * cells list
 *
 * List running sandbox sessions for a project.
 *
 * Usage:
 *   cells list --project <projectId>
 *   cells list --project <projectId> --json
 */

import { requireApiKey, requireProjectId } from "../config.js"
import { listSessions } from "../client.js"

export function registerList(program) {
  program
    .command("list")
    .description("List running sandbox sessions")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--json", "Output raw JSON response")
    .action(async (opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await listSessions(projectId)
        const sessions = result.sessions || []

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        if (sessions.length === 0) {
          console.log("No active sessions.")
          return
        }

        const pad = (s, n) => String(s).padEnd(n)
        console.log(
          pad("SESSION ID", 26) +
          pad("LANGUAGE", 14) +
          pad("STATUS", 10) +
          pad("STARTED", 22) +
          "EXPIRES"
        )
        console.log("-".repeat(96))
        for (const s of sessions) {
          const started = s.startedAt ? new Date(s.startedAt).toISOString() : "N/A"
          const expires = s.timeoutAt ? new Date(s.timeoutAt).toISOString() : "N/A"
          console.log(
            pad(s._id, 26) +
            pad(`${s.language} ${s.languageVersion}`, 14) +
            pad(s.status, 10) +
            pad(started, 22) +
            expires
          )
        }
      } catch (err) {
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })
}
