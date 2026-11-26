/**
 * Request paths and query strings for the Cells gateway.
 *
 * Every builder here is pure: it takes plain values and returns a string, so the route shapes can be
 * tested without a network or a config file. The gateway serves the customer surface under /v1/cells
 * (see its public operation table). Path parameters are always encoded.
 */

import { posix } from "path"

const seg = (value) => encodeURIComponent(String(value))

/** /v1/cells */
export const CELLS_PATH = "/v1/cells"
/** /v1/usage */
export const USAGE_PATH = "/v1/usage"

/**
 * Refuse a cell name the gateway cannot address. "." and ".." are path segments: the URL parser resolves them,
 * so /v1/cells/.. would reach another route. Throws before any request is sent.
 */
export function assertCellName(name) {
  if (name === "." || name === "..") {
    throw new Error(`Invalid cell name "${name}": "." and ".." are path segments, not cell names`)
  }
  return name
}

/** /v1/cells/{name} */
export function cellPath(name) {
  return `${CELLS_PATH}/${seg(assertCellName(name))}`
}

/** /v1/cells/{name}/exec */
export function execPath(name) {
  return `${cellPath(name)}/exec`
}

/** /v1/cells/{name}/checkpoint */
export function checkpointCreatePath(name) {
  return `${cellPath(name)}/checkpoint`
}

/** /v1/cells/{name}/checkpoints */
export function checkpointsPath(name) {
  return `${cellPath(name)}/checkpoints`
}

/** /v1/cells/{name}/checkpoints/{checkpointId} */
export function checkpointPath(name, checkpointId) {
  return `${checkpointsPath(name)}/${seg(checkpointId)}`
}

/** /v1/cells/{name}/checkpoints/{checkpointId}/restore */
export function checkpointRestorePath(name, checkpointId) {
  return `${checkpointPath(name, checkpointId)}/restore`
}

/** /v1/cells/{name}/fs/{operation}, for example fs/read, fs/write, fs/list, fs/delete. */
export function fsPath(name, operation) {
  return `${cellPath(name)}/fs/${seg(operation)}`
}

/** /v1/cells/{name}/services */
export function servicesPath(name) {
  return `${cellPath(name)}/services`
}

/** /v1/cells/{name}/services/{service} */
export function servicePath(name, service) {
  return `${servicesPath(name)}/${seg(service)}`
}

/** /v1/cells/{name}/services/{service}/{action}, for example start, stop, restart, logs. */
export function serviceActionPath(name, service, action) {
  return `${servicePath(name, service)}/${seg(action)}`
}

/**
 * True when a file path resolves to the filesystem root. An absolute path is normalised on its own ("/.",
 * "/tmp/..", "//" all resolve to "/"). A relative path is joined onto an absolute --working-dir first. A relative
 * path with no absolute working directory cannot be resolved here, so it is not treated as the root.
 */
export function resolvesToRoot(path, workingDir) {
  let target
  if (path.startsWith("/")) target = path
  else if (workingDir && workingDir.startsWith("/")) target = posix.join(workingDir, path)
  else return false
  return posix.normalize(target) === "/"
}

/**
 * Turn a query object into a query string without the leading "?". Array values repeat their key
 * (exec `cmd` and `env`), and null or undefined values are dropped. Keys keep their order.
 */
export function buildQuery(query) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, String(item))
  }
  return params.toString()
}

/** The WebSocket origin for an API URL: https becomes wss, http becomes ws, any other scheme is kept. */
export function wsBaseUrl(apiUrl) {
  const url = new URL(apiUrl)
  if (url.protocol === "https:") url.protocol = "wss:"
  else if (url.protocol === "http:") url.protocol = "ws:"
  return url.toString().replace(/\/+$/, "")
}

/** The WebSocket URL of an interactive exec session: /v1/cells/{name}/exec with the tty query set. */
export function wsExecUrl(apiUrl, name, { cmd, dir, env, tty = true } = {}) {
  const query = buildQuery({ cmd, dir, env, tty: tty ? "true" : undefined })
  return `${wsBaseUrl(apiUrl)}${execPath(name)}${query ? `?${query}` : ""}`
}

/**
 * The exit status in an x-cells-exit-code header value, or null when the header is absent or not an
 * integer ("unknown" is what the gateway sends when it could not read the status).
 */
export function parseExitCode(raw) {
  if (raw === null || raw === undefined) return null
  const value = String(raw).trim()
  return /^-?\d+$/.test(value) ? Number(value) : null
}
