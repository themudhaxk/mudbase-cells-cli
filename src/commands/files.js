/**
 * cells files read|ls|write|rm
 *
 * Work with a cell's filesystem. Paths are resolved from --working-dir when they are relative.
 * Content is moved as bytes in both directions, so a binary file round-trips unchanged.
 *
 * Usage:
 *   cells files read my-cell notes.txt --working-dir /tmp
 *   cells files read my-cell app.tar.gz --working-dir /tmp --output ./app.tar.gz
 *   cells files ls my-cell /tmp --json
 *   cells files write my-cell app.py --working-dir /tmp --from ./app.py --mkdir
 *   echo hello | cells files write my-cell hello.txt --working-dir /tmp
 *   cells files rm my-cell /tmp/tmp --working-dir /tmp --recursive
 */

import { readFileSync, writeFileSync } from "fs"
import { requireApiKey } from "../config.js"
import { deleteFile, listDirectory, readFile, writeFile } from "../client.js"
import { printJson, printTable, readStdin } from "../output.js"

export function registerFiles(program) {
  const files = program.command("files").description("Read, list, write and remove files in a cell")

  files
    .command("read <name> <path>")
    .description("Print a file's content, or save it with --output")
    .option("--working-dir <dir>", "Directory that relative paths resolve from")
    .option("--output <localFile>", "Save the content to a local file instead of printing it")
    .action(async (name, path, opts) => {
      requireApiKey()
      const content = await readFile(name, { path, workingDir: opts.workingDir })
      if (opts.output) {
        writeFileSync(opts.output, content)
        console.log(`Saved ${content.length} bytes to ${opts.output}`)
        return
      }
      process.stdout.write(content)
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
      const content = opts.from ? readFileSync(opts.from) : await readStdin()
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
