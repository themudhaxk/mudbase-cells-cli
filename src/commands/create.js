/**
 * cells create
 *
 * Create a new sandbox session. Prints the sessionId and wsUrl so
 * downstream commands (exec, console) can use them.
 *
 * Usage:
 *   cells create --project <projectId> [--language python] [--runtime-version 3.12] [--timeout 300]
 *   cells create --project <projectId> --json
 */

import { requireApiKey, requireProjectId } from "../config.js"
import { createSession } from "../client.js"

export function registerCreate(program) {
  program
    .command("create")
    .description("Create a new sandbox session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("-l, --language <lang>", "Runtime language: python or node", "python")
    .option("--runtime-version <ver>", "Language version, e.g. 3.12 or 22", "3.12")
    .option("-t, --timeout <seconds>", "Hard timeout in seconds", "300")
    .option("--json", "Output raw JSON response")
    .action(async (opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      const timeoutSeconds = parseInt(opts.timeout, 10)
      if (isNaN(timeoutSeconds) || timeoutSeconds < 30) {
        console.error("Error: --timeout must be >= 30 seconds")
        process.exit(1)
      }

      try {
        const result = await createSession(projectId, {
          language: opts.language,
          languageVersion: opts.runtimeVersion,
          timeoutSeconds,
        })

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log(`Session created`)
        console.log(`  ID:       ${result.sessionId}`)
        console.log(`  Language: ${result.language} ${result.languageVersion}`)
        console.log(`  Timeout:  ${result.timeoutAt}`)
        console.log(`  WS URL:   ${result.wsUrl}`)
      } catch (err) {
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })
}
