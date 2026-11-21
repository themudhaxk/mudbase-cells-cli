/**
 * cells services list|get|start|stop|restart|logs
 *
 * A service is a long-running process inside a cell (for example a web server). Start streams progress
 * events, one JSON line each.
 *
 * Usage:
 *   cells services list my-cell
 *   cells services start my-cell web
 *   cells services logs my-cell web --lines 100
 *   cells services stop my-cell web
 */

import { requireApiKey } from "../config.js"
import {
  getService,
  getServiceLogs,
  listServices,
  restartService,
  startService,
  stopService,
} from "../client.js"
import { printJson, printTable } from "../output.js"

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
          { header: "STATUS", get: (s) => s.status },
          { header: "PID", get: (s) => s.pid },
        ],
        items,
      )
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
    .option("--duration <seconds>", "How long the service may run")
    .action(async (name, service, opts) => {
      requireApiKey()
      const events = await startService(name, service, {
        duration: opts.duration ? Number(opts.duration) : undefined,
      })
      for (const event of events) console.log(JSON.stringify(event))
    })

  services
    .command("stop <name> <service>")
    .description("Stop a running service")
    .action(async (name, service) => {
      requireApiKey()
      printJson(await stopService(name, service))
    })

  services
    .command("restart <name> <service>")
    .description("Restart a service")
    .action(async (name, service) => {
      requireApiKey()
      printJson(await restartService(name, service))
    })

  services
    .command("logs <name> <service>")
    .description("Print a service's logs")
    .option("--lines <n>", "Number of recent lines")
    .action(async (name, service, opts) => {
      requireApiKey()
      process.stdout.write(await getServiceLogs(name, service, { lines: opts.lines }))
    })
}
