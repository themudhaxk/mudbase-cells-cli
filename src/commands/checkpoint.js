/**
 * cells checkpoint create|list|restore
 *
 * A checkpoint saves a cell's state so it can be restored later. Create and restore stream progress events;
 * each event is printed as one "<type>: <message>" line in Cells vocabulary, and a failed event stops the
 * command with exit status 1. The gateway has no checkpoint delete route, so there is no delete command.
 *
 * Usage:
 *   cells checkpoint create my-cell --comment "before deploy"
 *   cells checkpoint list my-cell
 *   cells checkpoint restore my-cell <checkpointId>
 */

import { requireApiKey } from "../config.js"
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from "../client.js"
import { printEvents, printJson, printTable } from "../output.js"

export function registerCheckpoint(program) {
  const checkpoint = program.command("checkpoint").description("Create, list and restore cell checkpoints")

  checkpoint
    .command("create <name>")
    .description("Create a checkpoint of the cell's current state")
    .option("--comment <text>", "Label stored with the checkpoint")
    .action(async (name, opts) => {
      requireApiKey()
      printEvents(await createCheckpoint(name, opts.comment))
    })

  checkpoint
    .command("list <name>")
    .description("List a cell's checkpoints")
    .option("--json", "Output raw JSON response")
    .action(async (name, opts) => {
      requireApiKey()
      const result = await listCheckpoints(name)
      if (opts.json) {
        printJson(result)
        return
      }
      const items = Array.isArray(result) ? result : result.checkpoints || []
      if (items.length === 0) {
        console.log("No checkpoints.")
        return
      }
      printTable(
        [
          { header: "ID", get: (c) => c.id },
          { header: "COMMENT", get: (c) => c.comment },
          { header: "CREATED", get: (c) => c.create_time },
        ],
        items,
      )
    })

  checkpoint
    .command("restore <name> <checkpointId>")
    .description("Restore a cell to a checkpoint (streams progress)")
    .action(async (name, checkpointId) => {
      requireApiKey()
      printEvents(await restoreCheckpoint(name, checkpointId))
    })
}
