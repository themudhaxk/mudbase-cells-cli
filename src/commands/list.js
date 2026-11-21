/**
 * cells list
 *
 * List the cells in your organization, newest page first as the gateway returns them.
 *
 * Usage:
 *   cells list
 *   cells list --prefix dev- --max-results 20
 *   cells list --continuation-token <token>
 *   cells list --json
 */

import { requireApiKey } from "../config.js"
import { listCells } from "../client.js"
import { printJson, printTable } from "../output.js"

export function registerList(program) {
  program
    .command("list")
    .description("List cells in your organization")
    .option("--prefix <prefix>", "Only cells whose name starts with this prefix")
    .option("--max-results <n>", "Maximum results per page (1 to 500, default 50)")
    .option("--continuation-token <token>", "Token from a previous page")
    .option("--json", "Output raw JSON response")
    .action(async (opts) => {
      requireApiKey()
      const result = await listCells({
        prefix: opts.prefix,
        maxResults: opts.maxResults,
        continuationToken: opts.continuationToken,
      })
      const cells = result.cells || []

      if (opts.json) {
        printJson(result)
        return
      }

      if (cells.length === 0) {
        console.log("No cells.")
      } else {
        printTable(
          [
            { header: "NAME", get: (c) => c.name },
            { header: "STATUS", get: (c) => c.status },
            { header: "CREATED", get: (c) => c.created_at },
            { header: "URL", get: (c) => c.url },
          ],
          cells,
        )
      }

      if (result.has_more && result.next_continuation_token) {
        console.log(`More results: --continuation-token ${result.next_continuation_token}`)
      }
    })
}
