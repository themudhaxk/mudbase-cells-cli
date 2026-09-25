/**
 * cells snapshot
 *
 * Checkpoint and restore sandbox session filesystem state.
 *
 * Subcommands:
 *   cells snapshot create <sessionId> [--project <id>] [--label <text>]
 *   cells snapshot list   <sessionId> [--project <id>]
 *   cells snapshot restore <sessionId> <snapshotId> [--project <id>]
 *
 * Note: the snapshot/restore API is under active development. These commands
 * wire against the documented expected endpoints and fail with a clear message
 * if the backend has not yet enabled the feature.
 */

import { requireApiKey, requireProjectId } from "../config.js"
import { createSnapshot, listSnapshots, restoreSnapshot } from "../client.js"

const NOT_AVAILABLE_MSG =
  "Snapshot API is not yet available on this server. " +
  "This feature is in progress and will be enabled in a future release."

/**
 * Detect a "not implemented" or "not found" API error and print the
 * not-available message instead of a raw error.
 *
 * @param {Error} err
 * @returns {boolean} true if the error was handled as "not available"
 */
function handleNotAvailable(err) {
  // 404 = route not yet deployed; 501 = stub returning Not Implemented
  if (err.status === 404 || err.status === 501) {
    console.error(`Error: ${NOT_AVAILABLE_MSG}`)
    return true
  }
  return false
}

export function registerSnapshot(program) {
  const snapshot = program
    .command("snapshot")
    .description("Checkpoint and restore sandbox session state")

  // cells snapshot create <sessionId>
  snapshot
    .command("create <sessionId>")
    .description("Create a snapshot of a running session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--label <text>", "Human-readable label for this snapshot")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await createSnapshot(projectId, sessionId, {
          label: opts.label,
        })

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log("Snapshot created")
        console.log(`  ID:        ${result.snapshotId || result._id}`)
        if (result.label) console.log(`  Label:     ${result.label}`)
        console.log(`  Created:   ${result.createdAt}`)
        if (result.sizeBytes != null) {
          console.log(`  Size:      ${(result.sizeBytes / 1024 / 1024).toFixed(2)} MB`)
        }
      } catch (err) {
        if (handleNotAvailable(err)) process.exit(2)
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })

  // cells snapshot list <sessionId>
  snapshot
    .command("list <sessionId>")
    .description("List snapshots for a session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await listSnapshots(projectId, sessionId)
        const snapshots = result.snapshots || []

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        if (snapshots.length === 0) {
          console.log("No snapshots found.")
          return
        }

        const pad = (s, n) => String(s).padEnd(n)
        console.log(
          pad("SNAPSHOT ID", 26) +
          pad("LABEL", 20) +
          "CREATED"
        )
        console.log("-".repeat(70))
        for (const s of snapshots) {
          const id = s._id || s.snapshotId || ""
          const label = s.label || ""
          const created = s.createdAt ? new Date(s.createdAt).toISOString() : "N/A"
          console.log(pad(id, 26) + pad(label, 20) + created)
        }
      } catch (err) {
        if (handleNotAvailable(err)) process.exit(2)
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })

  // cells snapshot restore <sessionId> <snapshotId>
  snapshot
    .command("restore <sessionId> <snapshotId>")
    .description("Restore a session from a snapshot")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, snapshotId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await restoreSnapshot(projectId, sessionId, snapshotId)

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log("Session restored from snapshot")
        if (result.sessionId) console.log(`  Session ID: ${result.sessionId}`)
        if (result.snapshotId) console.log(`  Snapshot:   ${result.snapshotId}`)
      } catch (err) {
        if (handleNotAvailable(err)) process.exit(2)
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })
}
