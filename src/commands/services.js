/**
 * cells services
 *
 * Manage long-running services inside a sandbox session.
 *
 * Subcommands:
 *   cells services start <sessionId> --name <name> --cmd <executable> [args...] [--project <id>]
 *   cells services stop  <sessionId> <serviceName> [--project <id>]
 *   cells services ls    <sessionId> [--project <id>]
 *
 * Port readiness:
 *   When --port and --wait-for-port are set, the CLI waits until the service's
 *   port is reachable (up to --timeout seconds) before returning. Useful for
 *   web servers that need a few seconds to bind before receiving traffic.
 *
 *   After start, the preview URL (https://sb-{id}-{port}.sandbox.mudbase.dev)
 *   is printed. Use `cells expose` for a URL that stays stable across restarts.
 */

import { requireApiKey, requireProjectId } from "../config.js"
import { listServices, startService, stopService } from "../client.js"
import { quotaErrorMessage } from "./exec.js"

export function registerServices(program) {
  const services = program
    .command("services")
    .description("Manage long-running services inside a session")

  // ---- services ls --------------------------------------------------------

  services
    .command("ls <sessionId>")
    .description("List services running inside the session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        const result = await listServices(projectId, sessionId)

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        const svcList = result.services ?? []
        if (svcList.length === 0) {
          console.log("No services running.")
          return
        }

        const pad = (s, n) => String(s ?? "").padEnd(n)
        console.log(pad("NAME", 20) + pad("STATUS", 12) + pad("PID", 8) + "PORT")
        console.log("-".repeat(50))
        for (const svc of svcList) {
          console.log(
            pad(svc.name, 20) +
            pad(svc.status, 12) +
            pad(svc.pid ?? "", 8) +
            (svc.port ?? "")
          )
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

  // ---- services start -----------------------------------------------------

  services
    .command("start <sessionId>")
    .description("Start a named service inside the session")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .requiredOption("--name <name>", "Service name (alphanumeric, hyphens, underscores)")
    .requiredOption(
      "--cmd <executable>",
      "Executable to run, e.g. python. Pass extra arguments after -- or via --args.",
    )
    .option("--args <args>", "Comma-separated arguments to pass to the command (e.g. app.py,--host,0.0.0.0)")
    .option("--cwd <path>", "Working directory inside the cell (default: /workspace)", "/workspace")
    .option("--port <port>", "Port the service listens on (integer)", parseInt)
    .option(
      "--wait-for-port",
      "Wait until the port is reachable before returning (requires --port)",
    )
    .option(
      "--timeout <seconds>",
      "How long to wait for port readiness in seconds (default: 60)",
      "60",
    )
    .option("--json", "Output raw JSON response")
    .action(async (sessionId, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      // API expects cmd as a string (the executable) and args as an array of strings.
      // Do NOT combine them into a single array — the API's startService endpoint
      // validates `typeof cmd === "string"` and `Array.isArray(args)` separately.
      const cmd = opts.cmd
      const args = opts.args
        ? opts.args.split(",").map((a) => a.trim()).filter(Boolean)
        : []

      const timeoutSeconds = parseInt(opts.timeout, 10)
      if (isNaN(timeoutSeconds) || timeoutSeconds < 1) {
        console.error("Error: --timeout must be >= 1 second")
        process.exit(1)
      }

      const serviceOpts = {
        name: opts.name,
        cmd,
        args,
        cwd: opts.cwd,
      }
      if (opts.port !== undefined && !isNaN(opts.port)) {
        serviceOpts.port = opts.port
      }
      if (opts.waitForPort) {
        if (serviceOpts.port === undefined) {
          console.error("Error: --wait-for-port requires --port")
          process.exit(1)
        }
        serviceOpts.waitForPort = true
        serviceOpts.timeoutMs = timeoutSeconds * 1000
      }

      try {
        const result = await startService(projectId, sessionId, serviceOpts)

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        console.log(`Service started: ${result.name ?? opts.name}`)
        if (result.pid) console.log(`  PID:     ${result.pid}`)
        if (result.port) console.log(`  Port:    ${result.port}`)
        if (result.publicUrl) console.log(`  URL:     ${result.publicUrl}`)
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

  // ---- services stop ------------------------------------------------------

  services
    .command("stop <sessionId> <serviceName>")
    .description("Stop a named service (no-op if already stopped)")
    .option("-p, --project <id>", "Project ID (overrides config / CELLS_PROJECT_ID)")
    .action(async (sessionId, serviceName, opts) => {
      requireApiKey()
      const projectId = requireProjectId(opts.project)

      try {
        await stopService(projectId, sessionId, serviceName)
        console.log(`Service stopped: ${serviceName}`)
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
}
