#!/usr/bin/env node
/**
 * cells - Mudbase Cells CLI
 *
 * Authentication:
 *   Set CELLS_API_KEY (a cells_... key) or add apiKey to ~/.cells/config.json
 *   Optional: CELLS_API_URL (default https://cells-api.mudbase.dev)
 *
 * Quick start:
 *   cells create my-cell
 *   cells list
 *   cells exec my-cell -- python3 -c "print('hello')"
 *   cells files read my-cell notes.txt --working-dir /home/cell
 *   cells checkpoint create my-cell --comment "before deploy"
 */

import { Command } from "commander"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

import { registerCreate } from "./commands/create.js"
import { registerList } from "./commands/list.js"
import { registerCell } from "./commands/cell.js"
import { registerExec } from "./commands/exec.js"
import { registerCheckpoint } from "./commands/checkpoint.js"
import { registerFiles } from "./commands/files.js"
import { registerServices } from "./commands/services.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8"))

const program = new Command()

program
  .name("cells")
  .description("Mudbase Cells - Linux cells with persistent storage, exec, services and checkpoints")
  .version(pkg.version)

registerCreate(program)
registerList(program)
registerCell(program)
registerExec(program)
registerCheckpoint(program)
registerFiles(program)
registerServices(program)

program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
