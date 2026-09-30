/**
 * cells files
 *
 * Read and write files inside a running sandbox session.
 *
 * Subcommands:
 *   cells files write  <sessionId> <localPath> [--project <id>] [--remote-path <path>] [--binary]
 *   cells files read   <sessionId> <remotePath> [--project <id>] [--output <localPath>]
 *   cells files ls     <sessionId> <remotePath> [--project <id>]
 *
 * Binary files:
 *   Pass --binary when writing a file whose content is not valid UTF-8. The
 *   local file is base64-encoded before upload. Text files (default) are sent
 *   as-is with encoding "text".
 *
 * Per-file failures (HTTP 207):
 *   The server returns HTTP 207 Multi-Status when a batch write partially
 *   succeeded. Each file's result is in result.results[]. A failure on one
 *   file does NOT abort the others. This command prints each per-file
 *   outcome and exits with a non-zero code when any file failed.
 */

import { readFileSync, writeFileSync } from "fs"
import { basename } from "path"
import { requireApiKey, requireProjectId, getConfig } from "../config.js"
import { writeFiles, readFile } from "../client.js"
import { quotaErrorMessage } from "./exec.js"

export function registerFiles(program) {
  const files = program
    .command("files")
    .description("Read and write files inside a running session")

  // ---- files write --------------------------------------------------------

  files
    .command("write <sessionId> <localPath>")
    .description("Write a local file into the session's /workspace")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option(
      "--remote-path <path>",
      "Destination path inside the cell (default: /workspace/<basename of localPath>)",
    )
    .option("--binary", "Encode as base64 (required for non-UTF-8 files)")
    .action(async (sessionId, localPath, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      let content
      try {
        if (opts.binary) {
          content = readFileSync(localPath).toString("base64")
        } else {
          content = readFileSync(localPath, "utf8")
        }
      } catch (err) {
        console.error(`Error reading local file: ${err.message}`)
        process.exit(1)
      }

      const remotePath = opts.remotePath ?? `/workspace/${basename(localPath)}`
      const encoding = opts.binary ? "base64" : "text"

      try {
        const result = await writeFiles(projectId, sessionId, [
          { path: remotePath, content, encoding },
        ])

        // Inspect per-file results from a 207 Multi-Status response.
        const fileResults = result.results ?? result.files ?? []
        let anyFailed = false
        for (const r of fileResults) {
          if (r.success) {
            console.log(`  ok  ${r.path}`)
          } else {
            console.error(`  fail  ${r.path}: ${r.error ?? "unknown error"}`)
            anyFailed = true
          }
        }

        if (fileResults.length === 0 && result.success !== false) {
          // Single-file success with no per-file breakdown.
          console.log(`Written: ${remotePath}`)
        } else if (anyFailed) {
          process.exit(1)
        }
      } catch (err) {
        const quota = quotaErrorMessage(err.status)
        if (quota) {
          console.error(`Error: ${quota}`)
          process.exit(1)
        }
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })

  // ---- files read ---------------------------------------------------------

  files
    .command("read <sessionId> <remotePath>")
    .description("Read a file from the session's filesystem and print it (or save with --output)")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--output <localPath>", "Save to a local file instead of printing to stdout")
    .action(async (sessionId, remotePath, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await readFile(projectId, sessionId, remotePath)

        let bytes
        if (result.encoding === "base64") {
          bytes = Buffer.from(result.content, "base64")
        } else {
          bytes = Buffer.from(result.content ?? "", "utf8")
        }

        if (opts.output) {
          try {
            writeFileSync(opts.output, bytes)
            console.log(`Saved ${result.size ?? bytes.length} bytes to ${opts.output}`)
          } catch (err) {
            console.error(`Error saving file: ${err.message}`)
            process.exit(1)
          }
        } else {
          process.stdout.write(bytes)
        }
      } catch (err) {
        const quota = quotaErrorMessage(err.status)
        if (quota) {
          console.error(`Error: ${quota}`)
          process.exit(1)
        }
        console.error(`Error: ${err.message}`)
        process.exit(1)
      }
    })

  // ---- files ls -----------------------------------------------------------

  files
    .command("ls <sessionId> [remotePath]")
    .description("List files at a path inside the session (uses exec ls -la under the hood)")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .action(async (sessionId, remotePath, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      const dir = remotePath ?? "/workspace"
      const { apiUrl } = getConfig()
      const apiKey = requireApiKey()

      const execUrl = `${apiUrl}/api/sandboxes/projects/${projectId}/sessions/${sessionId}/exec`

      let res
      try {
        res = await fetch(execUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify({
            cmd: ["ls", "-la", dir],
            timeoutMs: 10000,
            workingDir: "/workspace",
          }),
        })
      } catch (err) {
        console.error(`Error: network failure reaching API: ${err.message}`)
        process.exit(1)
      }

      if (!res.ok) {
        const quota = quotaErrorMessage(res.status)
        if (quota) {
          console.error(`Error: ${quota}`)
          process.exit(1)
        }
        let errText
        try { errText = await res.text() } catch { errText = String(res.status) }
        console.error(`Error: API returned ${res.status}: ${errText}`)
        process.exit(1)
      }

      let exitCode = 0
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split("\n\n")
          buffer = parts.pop() || ""

          for (const eventBlock of parts) {
            for (const rawLine of eventBlock.split("\n")) {
              const line = rawLine.trim()
              if (!line || line.startsWith(":")) continue
              if (line.startsWith("data: ")) {
                const data = line.slice(6)
                if (data.startsWith("stdout:")) {
                  process.stdout.write(data.slice(7) + "\n")
                } else if (data.startsWith("stderr:")) {
                  process.stderr.write(data.slice(7) + "\n")
                } else if (data.startsWith("exit:")) {
                  const code = parseInt(data.slice(5), 10)
                  exitCode = Number.isFinite(code) ? code : 1
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`Error streaming output: ${err.message}`)
        process.exit(1)
      }

      process.exit(exitCode)
    })
}
