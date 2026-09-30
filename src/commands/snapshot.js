/**
 * cells checkpoint
 *
 * Checkpoint and restore sandbox session filesystem state.
 * Requires the session to have been created with a --cell-name (persistent volume).
 *
 * Subcommands:
 *   cells checkpoint create  <sessionId> [--project <id>] [--name <text>]
 *   cells checkpoint list    <sessionId> [--project <id>]
 *   cells checkpoint restore <sessionId> <checkpointId> [--project <id>]
 *   cells checkpoint delete  <sessionId> <checkpointId> [--project <id>]
 */

import { requireApiKey, requireProjectId } from "../config.js"
import {
  createCheckpoint,
  listCheckpoints,
  restoreFromCheckpoint,
  deleteCheckpoint,
  getRestoreJob,
} from "../client.js"

const NOT_AVAILABLE_MSG =
  "Checkpoint API is not yet available on this server. " +
  "This feature requires a session created with a --cell-name option (persistent volume)."

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

/**
 * Poll a restore job until it reaches a terminal state (succeeded or failed).
 * Prints progress dots to stderr and returns once done.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {string} restoreId
 * @param {number} pollIntervalMs
 * @returns {Promise<object>} Final job result object
 */
async function pollRestoreJob(projectId, sessionId, restoreId, pollIntervalMs = 2000) {
  process.stderr.write("Waiting for restore")
  const MAX_POLLS = 120 // 4 minutes max
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    process.stderr.write(".")
    let job
    try {
      job = await getRestoreJob(projectId, sessionId, restoreId)
    } catch (err) {
      process.stderr.write("\n")
      throw err
    }
    const status = job.status
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      process.stderr.write("\n")
      return job
    }
  }
  process.stderr.write("\n")
  throw new Error("Restore job timed out after polling. Check the API for job status: " + restoreId)
}

export function registerSnapshot(program) {
  const checkpoint = program
    .command("checkpoint")
    .description("Checkpoint and restore sandbox session filesystem state (requires a named cell)")

  // cells checkpoint create <sessionId>
  checkpoint
    .command("create <sessionId>")
    .description("Create a checkpoint of a running or suspended named-cell session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--name <text>", "Human-readable name for this checkpoint (max 200 chars)")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await createCheckpoint(projectId, sessionId, {
          name: opts.name,
        })

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log("Checkpoint created")
        console.log(`  Checkpoint ID: ${result.checkpointId}`)
        if (result.snapshotId) console.log(`  Snapshot ID:   ${result.snapshotId}`)
        if (result.name) console.log(`  Name:          ${result.name}`)
        if (result.sizeGb != null) console.log(`  Size:          ${result.sizeGb} GB`)
        console.log(`  Created:       ${result.createdAt}`)
      } catch (err) {
        if (handleNotAvailable(err)) process.exit(2)
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })

  // cells checkpoint list <sessionId>
  checkpoint
    .command("list <sessionId>")
    .description("List checkpoints for a named-cell session, newest first")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await listCheckpoints(projectId, sessionId)
        const checkpoints = result.checkpoints || []

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        if (checkpoints.length === 0) {
          console.log("No checkpoints found.")
          return
        }

        const pad = (s, n) => String(s).padEnd(n)
        console.log(
          pad("CHECKPOINT ID", 28) +
          pad("NAME", 24) +
          pad("SIZE", 8) +
          "CREATED"
        )
        console.log("-".repeat(80))
        for (const c of checkpoints) {
          const id = c.id || c.checkpointId || ""
          const name = c.name || ""
          const size = c.sizeGb != null ? `${c.sizeGb} GB` : "N/A"
          const created = c.createdAt ? new Date(c.createdAt).toISOString() : "N/A"
          console.log(pad(id, 28) + pad(name, 24) + pad(size, 8) + created)
        }
      } catch (err) {
        if (handleNotAvailable(err)) process.exit(2)
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })

  // cells checkpoint restore <sessionId> <checkpointId>
  checkpoint
    .command("restore <sessionId> <checkpointId>")
    .description("Restore a session volume from a checkpoint (async; polls until complete)")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--no-wait", "Start the restore job but do not wait for it to complete")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, checkpointId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const started = await restoreFromCheckpoint(projectId, sessionId, checkpointId)

        if (opts.json && opts.noWait) {
          console.log(JSON.stringify(started, null, 2))
          return
        }

        if (opts.noWait) {
          console.log(`Restore job started: ${started.restoreId}`)
          console.log("Poll status with: cells checkpoint restore-status <sessionId> <restoreId>")
          return
        }

        const job = await pollRestoreJob(projectId, sessionId, started.restoreId)

        if (opts.json) {
          console.log(JSON.stringify(job, null, 2))
          return
        }

        if (job.status === "succeeded") {
          console.log("Session restored from checkpoint successfully")
          if (job.restoreId) console.log(`  Restore ID:    ${job.restoreId}`)
          if (job.completedAt) console.log(`  Completed:     ${job.completedAt}`)
        } else {
          console.error(`Restore ${job.status}: ${job.error || "unknown error"}`)
          process.exit(1)
        }
      } catch (err) {
        if (handleNotAvailable(err)) process.exit(2)
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })

  // cells checkpoint delete <sessionId> <checkpointId>
  checkpoint
    .command("delete <sessionId> <checkpointId>")
    .description("Delete a checkpoint and its underlying volume snapshot")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, checkpointId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await deleteCheckpoint(projectId, sessionId, checkpointId)

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log(`Checkpoint deleted: ${result.checkpointId || checkpointId}`)
      } catch (err) {
        if (handleNotAvailable(err)) process.exit(2)
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })
}
