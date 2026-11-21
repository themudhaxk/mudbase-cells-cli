/**
 * cells files read|ls|write|rm
 *
 * Work with a cell's filesystem. Paths are resolved from --working-dir when they are relative.
 *
 * Usage:
 *   cells files read my-cell notes.txt --working-dir /home/cell
 *   cells files ls my-cell /home/cell --json
 *   cells files write my-cell /home/cell/app.py --working-dir /home/cell --from ./app.py --mkdir
 *   echo hello | cells files write my-cell /home/cell/hello.txt --working-dir /home/cell
 *   cells files rm my-cell /home/cell/tmp --working-dir /home/cell --recursive
 */

import { readFileSync } from "fs"
import { requireApiKey } from "../config.js"
import { deleteFile, listDirectory, readFile, writeFile } from "../client.js"
import { printJson, printTable, readStdin } from "../output.js"

export function registerFiles(program) {
  const files = program.command("files").description("Read, list, write and remove files in a cell")

  files
    .command("read <name> <path>")
    .description("Print a file's content")
    .option("--working-dir <dir>", "Directory that relative paths resolve from")
    .action(async (name, path, opts) => {
      requireApiKey()
      process.stdout.write(await readFile(name, { path, workingDir: opts.workingDir }))
    })

  files
    .command("ls <name> <path>")
    .description("List a directory")
    .option("--working-dir <dir>", "Directory that relative paths resolve from")
    .option("--json", "Output raw JSON response")
    .action(async (name, path, opts) => {
      requireApiKey()
      const result = await listDirectory(name, { path, workingDir: opts.workingDir })
      if (opts.json) {
        printJson(result)
        return
      }
      const entries = Array.isArray(result) ? result : result.entries || []
      printTable(
        [
          { header: "NAME", get: (e) => e.name },
          { header: "TYPE", get: (e) => e.type },
          { header: "SIZE", get: (e) => e.size },
        ],
        entries,
      )
    })

  files
    .command("write <name> <path>")
    .description("Write a file from --from or from stdin")
    .option("--working-dir <dir>", "Directory that relative paths resolve from")
    .option("--from <localFile>", "Local file to upload (default: read stdin)")
    .option("--mode <octal>", "File permissions, for example 0644")
    .option("--mkdir", "Create parent directories that do not exist")
    .action(async (name, path, opts) => {
      requireApiKey()
      const content = opts.from ? readFileSync(opts.from, "utf8") : await readStdin()
      const result = await writeFile(
        name,
        { path, workingDir: opts.workingDir, mode: opts.mode, mkdir: opts.mkdir ? true : undefined },
        content,
      )
      console.log(JSON.stringify(result))
    })

  files
    .command("rm <name> <path>")
    .description("Delete a file or directory")
    .option("--working-dir <dir>", "Directory that relative paths resolve from")
    .option("--recursive", "Delete a directory and its contents")
    .action(async (name, path, opts) => {
      requireApiKey()
      const result = await deleteFile(name, { path, workingDir: opts.workingDir, recursive: opts.recursive })
      console.log(JSON.stringify(result))
    })
}
