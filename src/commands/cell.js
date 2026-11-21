/**
 * cells get <name> / cells delete <name> / cells usage
 *
 * Usage:
 *   cells get my-cell
 *   cells get my-cell --json
 *   cells delete my-cell
 *   cells usage
 */

import { requireApiKey } from "../config.js"
import { deleteCell, getCell, getUsage } from "../client.js"
import { printJson } from "../output.js"

export function registerCell(program) {
  program
    .command("get <name>")
    .description("Show one cell")
    .option("--json", "Output raw JSON response")
    .action(async (name, opts) => {
      requireApiKey()
      const cell = await getCell(name)
      if (opts.json) {
        printJson(cell)
        return
      }
      console.log(`  Name:       ${cell.name}`)
      console.log(`  ID:         ${cell.id}`)
      console.log(`  Status:     ${cell.status}`)
      console.log(`  URL:        ${cell.url ?? ""}`)
      console.log(`  Created:    ${cell.created_at ?? ""}`)
      console.log(`  Updated:    ${cell.updated_at ?? ""}`)
    })

  program
    .command("delete <name>")
    .description("Delete a cell and all its resources (filesystem, checkpoints, services)")
    .action(async (name) => {
      requireApiKey()
      await deleteCell(name)
      console.log(`Deleted cell ${name}`)
    })

  program
    .command("usage")
    .description("Show your usage and limits for the current billing period (JSON)")
    .action(async () => {
      requireApiKey()
      printJson(await getUsage())
    })
}
