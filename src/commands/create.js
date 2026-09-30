/**
 * cells create
 *
 * Create a new sandbox session. Prints the sessionId and wsUrl so
 * downstream commands (exec, console) can use them.
 *
 * VOLUMES (persistence):
 *   Without --cell-name: session is EPHEMERAL. No /workspace volume is mounted;
 *   files written during the session are lost when it ends. Multiple concurrent
 *   sessions per project are supported.
 *
 *   With --cell-name <name>: session uses a PERSISTENT named volume. Files on
 *   /workspace persist across reconnects and restarts as long as the cell name
 *   is consistent. Named cells cannot run concurrently on the same name.
 *
 * Usage:
 *   cells create --project <projectId> [--language python] [--runtime-version 3.12] [--timeout 300]
 *   cells create --project <projectId> --cell-name my-project --language node
 *   cells create --project <projectId> --json
 */

import { requireApiKey, requireProjectId } from "../config.js"
import { createSession } from "../client.js"
import { quotaErrorMessage } from "./exec.js"

export function registerCreate(program) {
  program
    .command("create")
    .description("Create a new sandbox session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option(
      "-l, --language <lang>",
      "Runtime language: python, node, go, rust, php, java, ruby, or csharp",
      "python",
    )
    .option("--runtime-version <ver>", "Language version, e.g. 3.12 or 22", "3.12")
    .option("-t, --timeout <seconds>", "Hard timeout in seconds (min 30)", "300")
    .option(
      "--cell-name <name>",
      "Named cell: mounts a persistent /workspace volume (1-63 alphanumeric/underscore/hyphen). " +
        "Omit for an ephemeral session where /workspace is empty and files are lost on exit.",
    )
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
          cellName: opts.cellName,
        })

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        const expiresAt = result.timeoutAt ? new Date(result.timeoutAt).toISOString() : "N/A"
        const volumeType = opts.cellName
          ? `persistent (cell: ${opts.cellName})`
          : "ephemeral (files lost on exit)"

        console.log(`Session created`)
        console.log(`  ID:       ${result.sessionId}`)
        console.log(`  Language: ${result.language} ${result.languageVersion}`)
        console.log(`  Expires:  ${expiresAt}`)
        console.log(`  Volume:   ${volumeType}`)
        console.log(`  WS URL:   ${result.wsUrl}`)
      } catch (err) {
        const quota = quotaErrorMessage(err.status)
        if (quota) {
          console.error(`Error: ${quota}`)
          process.exit(1)
        }
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })
}
