/**
 * cells services list|get|start|stop|restart|logs
 *
 * A service is a long-running process inside a cell (for example a web server). It is defined once with
 * `define`, then started, stopped and restarted. Lifecycle calls stream progress events, printed one line each.
 *
 * Usage:
 *   cells services list my-cell
 *   cells services define my-cell web --cmd python3 --args -m,http.server,8000 --http-port 8000
 *   cells services start my-cell web --duration 5
 *   cells services logs my-cell web --lines 100
 *   cells services stop my-cell web
 */

import { requireApiKey } from "../config.js"
import {
  defineService,
  getService,
  getServiceLogs,
  listServices,
  restartService,
  startService,
  stopService,
} from "../client.js"
import { printEvents, printJson, printTable } from "../output.js"

function collect(value, previous) {
  return previous.concat([value])
}

/** The state object of a service entry, which the gateway nests under `state`. */
function stateOf(service) {
  return service && typeof service.state === "object" && service.state !== null ? service.state : {}
}

export function registerServices(program) {
  const services = program.command("services").description("Manage long-running services in a cell")

  services
    .command("list <name>")
    .description("List a cell's services")
    .option("--json", "Output raw JSON response")
    .action(async (name, opts) => {
      requireApiKey()
      const result = await listServices(name)
      if (opts.json) {
        printJson(result)
        return
      }
      const items = Array.isArray(result) ? result : result.services || []
      if (items.length === 0) {
        console.log("No services.")
        return
      }
      printTable(
        [
          { header: "NAME", get: (s) => s.name },
          { header: "STATUS", get: (s) => stateOf(s).status },
          { header: "PID", get: (s) => stateOf(s).pid },
          { header: "HTTP PORT", get: (s) => s.http_port },
          { header: "ERROR", get: (s) => stateOf(s).error },
        ],
        items,
      )
    })

  services
    .command("define <name> <service>")
    .description("Create or update a service definition (the gateway starts it)")
    .requiredOption("--cmd <executable>", "Command to run, for example python3")
    .option("--args <args>", "Comma-separated arguments (for example -m,http.server,8000)", "")
    .option("--dir <path>", "Working directory inside the cell")
    .option("--env <KEY=VALUE>", "Environment variable for the service (repeatable)", collect, [])
    .option("--http-port <port>", "Port used for HTTP routing", (value) => Number(value))
    .option("--needs <service>", "Service that must start first (repeatable)", collect, [])
    .action(async (name, service, opts) => {
      requireApiKey()
      const definition = {
        cmd: opts.cmd,
        args: opts.args ? opts.args.split(",").map((a) => a.trim()).filter(Boolean) : [],
        needs: opts.needs,
      }
      if (opts.dir !== undefined) definition.dir = opts.dir
      if (opts.env.length > 0) {
        definition.env = Object.fromEntries(
          opts.env.map((entry) => {
            const index = entry.indexOf("=")
            return index === -1 ? [entry, ""] : [entry.slice(0, index), entry.slice(index + 1)]
          }),
        )
      }
      if (opts.httpPort !== undefined) definition.http_port = opts.httpPort
      printEvents(await defineService(name, service, definition))
    })

  services
    .command("get <name> <service>")
    .description("Show one service")
    .action(async (name, service) => {
      requireApiKey()
      printJson(await getService(name, service))
    })

  services
    .command("start <name> <service>")
    .description("Start a service (streams progress)")
    .option("--duration <seconds>", "How long the gateway streams the service's first logs")
    .action(async (name, service, opts) => {
      requireApiKey()
      printEvents(
        await startService(name, service, {
          duration: opts.duration ? Number(opts.duration) : undefined,
        }),
      )
    })

  services
    .command("stop <name> <service>")
    .description("Stop a running service")
    .action(async (name, service) => {
      requireApiKey()
      printEvents(await stopService(name, service))
    })

  services
    .command("restart <name> <service>")
    .description("Restart a service")
    .action(async (name, service) => {
      requireApiKey()
      printEvents(await restartService(name, service))
    })

  services
    .command("logs <name> <service>")
    .description("Print a service's logs")
    .option("--lines <n>", "Number of recent lines")
    .action(async (name, service, opts) => {
      requireApiKey()
      printEvents(await getServiceLogs(name, service, { lines: opts.lines }))
    })
}
