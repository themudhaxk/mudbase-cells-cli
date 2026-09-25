#!/usr/bin/env node
/**
 * cells - Mudbase Cells CLI
 *
 * Authentication:
 *   Set CELLS_API_KEY env var or add apiKey to ~/.cells/config.json
 *
 * Quick start:
 *   cells create --project <projectId>
 *   cells list --project <projectId>
 *   cells exec <sessionId> --project <projectId> -- python -c "print('hello')"
 *   cells console <sessionId> --project <projectId>
 */

import { Command } from "commander"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

import { registerCreate } from "./commands/create.js"
import { registerList } from "./commands/list.js"
import { registerExec } from "./commands/exec.js"
import { registerConsole } from "./commands/console.js"
import { registerSnapshot } from "./commands/snapshot.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"))

const program = new Command()

program
  .name("cells")
  .description("Mudbase Cells - cloud sandbox CLI")
  .version(pkg.version)

registerCreate(program)
registerList(program)
registerExec(program)
registerConsole(program)
registerSnapshot(program)

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
