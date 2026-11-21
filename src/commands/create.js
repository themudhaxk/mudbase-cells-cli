/**
 * cells create <name>
 *
 * Create a cell: a Linux environment with a persistent filesystem. The name is unique within your organization.
 *
 * Usage:
 *   cells create my-cell
 *   cells create my-cell --json
 */

import { requireApiKey } from "../config.js"
import { createCell } from "../client.js"
import { printJson } from "../output.js"

export function registerCreate(program) {
  program
    .command("create <name>")
    .description("Create a cell with a unique name in your organization")
    .option("--json", "Output raw JSON response")
    .action(async (name, opts) => {
      requireApiKey()
      const cell = await createCell({ name })

      if (opts.json) {
        printJson(cell)
        return
      }

      console.log("Cell created")
      console.log(`  Name:   ${cell.name}`)
      console.log(`  ID:     ${cell.id}`)
      console.log(`  Status: ${cell.status}`)
      if (cell.url) console.log(`  URL:    ${cell.url}`)
    })
}
