/**
 * Cells gateway client.
 *
 * Every request goes to the gateway base URL (default https://cells-api.mudbase.dev, override with CELLS_API_URL)
 * under /v1/cells, with `Authorization: Bearer cells_...`. Route shapes come from the gateway's public surface
 * (mudbase-cells-gateway, its public operation table). Four response kinds exist:
 *   - JSON: most reads and writes.
 *   - NDJSON stream: checkpoint create, checkpoint restore, and service define, start, stop and restart. Each line
 *     is one event; an event of type "error" fails the call.
 *   - Plain body: file reads and service logs (bytes, not JSON).
 *   - Exec: a JSON summary (stdout, stderr, exitCode) when the request asks for it with
 *     `Accept: application/json`, or the plain output with the status in the x-cells-exit-code header.
 */

import { getConfig } from "./config.js"
import {
  CELLS_PATH,
  USAGE_PATH,
  buildQuery,
  cellPath,
  checkpointCreatePath,
  checkpointPath,
  checkpointRestorePath,
  checkpointsPath,
  execPath,
  fsPath,
  parseExitCode,
  serviceActionPath,
  servicePath,
  servicesPath,
} from "./paths.js"

export class CellsApiError extends Error {
  constructor(message, { status, code, body, retryAfter, upgradeUrl } = {}) {
    super(message)
    this.name = "CellsApiError"
    this.status = status
    this.code = code
    this.body = body
    this.retryAfter = retryAfter
    this.upgradeUrl = upgradeUrl
  }
}

/**
 * Build a request URL from the configured base and a path. A query value that is an array repeats its key
 * (exec `cmd`, `env`); null and undefined values are dropped.
 */
export function buildUrl(path, query) {
  const { apiUrl } = getConfig()
  const search = buildQuery(query)
  return `${apiUrl}${path}${search ? `?${search}` : ""}`
}

function parseRetryAfter(header, body) {
  if (header !== null && header !== undefined && /^\d+$/.test(header.trim())) return Number(header.trim())
  if (body && typeof body.retry_after_seconds === "number") return body.retry_after_seconds
  return undefined
}

/** Turn a non-2xx gateway answer into a CellsApiError with a readable message. */
export function errorFromResponse(status, headers, text) {
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  const apiMessage = body && typeof body.message === "string" ? body.message : undefined
  const code = body && typeof body.error === "string" ? body.error : undefined
  const retryAfter = parseRetryAfter(headers.get("retry-after"), body)
  const upgradeUrl = body && typeof body.upgrade_url === "string" ? body.upgrade_url : undefined

  let message
  if (status === 401) {
    message = "Invalid or missing API key (Cells keys start with cells_)"
  } else if (status === 403) {
    message = `${code || "forbidden"}: ${apiMessage || "plan allowance reached"}`
    if (upgradeUrl) message += ` (upgrade: ${upgradeUrl})`
  } else if (status === 404) {
    message = apiMessage || "Not found"
  } else if (status === 429) {
    message = `${code || "rate_limited"}: ${apiMessage || "too many requests"}`
    if (retryAfter !== undefined) message += ` (retry after ${retryAfter}s)`
  } else {
    message = apiMessage || `HTTP ${status}`
  }
  return new CellsApiError(message, { status, code, body, retryAfter, upgradeUrl })
}

async function send(method, path, { query, body, rawBody, accept } = {}) {
  const { apiKey } = getConfig()
  if (!apiKey) {
    throw new CellsApiError("API key required (set CELLS_API_KEY or apiKey in ~/.cells/config.json)")
  }

  const headers = { Authorization: `Bearer ${apiKey}` }
  if (accept) headers.Accept = accept
  let payload
  if (rawBody !== undefined) {
    headers["Content-Type"] = "application/octet-stream"
    payload = rawBody
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json"
    payload = JSON.stringify(body)
  }

  const url = buildUrl(path, query)
  let res
  try {
    res = await fetch(url, { method, headers, body: payload })
  } catch (err) {
    throw new CellsApiError(`Network error: ${err.message}`)
  }
  return { res, url }
}

/**
 * Send one request and return the answer as text. Throws CellsApiError for a non-2xx answer.
 *
 * @param {string} method
 * @param {string} path - path under the gateway base, starting with /v1/cells or /v1/usage
 * @param {object} [opts]
 * @param {object} [opts.query] - query values; arrays repeat the key
 * @param {object} [opts.body] - JSON body
 * @param {string|Buffer} [opts.rawBody] - raw octet-stream body (file writes)
 * @param {string} [opts.accept] - Accept header
 */
export async function cellsFetch(method, path, opts = {}) {
  const { res } = await send(method, path, opts)
  const text = await res.text()
  if (!res.ok) throw errorFromResponse(res.status, res.headers, text)
  return { status: res.status, headers: res.headers, text }
}

/** Send one request and return the answer as bytes (file reads, logs). */
export async function cellsFetchBuffer(method, path, opts = {}) {
  const { res } = await send(method, path, opts)
  const buffer = Buffer.from(await res.arrayBuffer())
  if (!res.ok) throw errorFromResponse(res.status, res.headers, buffer.toString("utf8"))
  return { status: res.status, headers: res.headers, buffer }
}

/** Parse a JSON answer; a body that is not JSON is returned as text. */
function parseBody(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Parse an NDJSON stream body into its events (one JSON object per non-empty line). */
export function parseNdjson(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        throw new CellsApiError(`Malformed stream line: ${line.slice(0, 120)}`)
      }
    })
}

/** The failure an event stream reports, or null. The gateway relays the upstream shape, which uses `error`. */
export function streamFailure(events) {
  return events.find((event) => event && event.type === "error") || null
}

async function requestJson(method, path, opts) {
  const { text } = await cellsFetch(method, path, opts)
  return parseBody(text)
}

/**
 * A stream answer. Live gateway answers are NDJSON, but a checkpoint list can also be a JSON array, so a
 * body whose content type is JSON is parsed as JSON and returned as one value.
 */
async function requestStream(method, path, opts) {
  const { headers, text } = await cellsFetch(method, path, opts)
  const contentType = headers.get("content-type") || ""
  if (!contentType.includes("ndjson")) {
    const parsed = parseBody(text)
    return Array.isArray(parsed) ? parsed : [parsed]
  }
  const events = parseNdjson(text)
  const failure = streamFailure(events)
  if (failure) {
    throw new CellsApiError(failure.error || failure.data || "Stream reported an error", {
      code: failure.code || undefined,
      body: failure,
    })
  }
  return events
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** POST /v1/cells. @param {{name: string, url_settings?: object}} body */
export function createCell(body) {
  return requestJson("POST", CELLS_PATH, { body })
}

/** GET /v1/cells. */
export function listCells({ prefix, maxResults, continuationToken } = {}) {
  return requestJson("GET", CELLS_PATH, {
    query: { prefix, max_results: maxResults, continuation_token: continuationToken },
  })
}

/** GET /v1/cells/{name}. The cell is at the top level and repeated under `data`. */
export function getCell(name) {
  return requestJson("GET", cellPath(name))
}

/** DELETE /v1/cells/{name}. */
export async function deleteCell(name) {
  const { status } = await cellsFetch("DELETE", cellPath(name))
  return { status }
}

/** GET /v1/usage: the caller's usage and limits for the current billing period. */
export function getUsage() {
  return requestJson("GET", USAGE_PATH)
}

// ---------------------------------------------------------------------------
// Exec
// ---------------------------------------------------------------------------

/**
 * POST /v1/cells/{name}/exec. `cmd` is the command and its arguments, one entry per argument.
 * `env` entries are KEY=VALUE strings.
 *
 * The request asks for the JSON form, which separates stdout from stderr and carries the exit status as a
 * number. A gateway that answers the plain form instead is read as output plus the x-cells-exit-code header.
 * The exit status is null when it is unknown (a gateway refusal, or output that ended without an exit frame).
 *
 * @returns {Promise<{stdout: string, stderr: string, exitCode: number|null, truncated: boolean}>}
 */
export async function execCell(name, { cmd, dir, env } = {}) {
  const { headers, text } = await cellsFetch("POST", execPath(name), {
    query: { cmd, dir, env },
    accept: "application/json",
  })
  const headerExit = parseExitCode(headers.get("x-cells-exit-code"))
  const contentType = headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return {
        stdout: typeof body.stdout === "string" ? body.stdout : "",
        stderr: typeof body.stderr === "string" ? body.stderr : "",
        exitCode: typeof body.exitCode === "number" ? body.exitCode : headerExit,
        truncated: body.truncated === true,
      }
    }
  }
  return { stdout: text, stderr: "", exitCode: headerExit, truncated: false }
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/** POST /v1/cells/{name}/checkpoint (NDJSON stream of info and complete events). */
export function createCheckpoint(name, comment) {
  return requestStream("POST", checkpointCreatePath(name), {
    body: comment ? { comment } : {},
  })
}

/** GET /v1/cells/{name}/checkpoints: a JSON array of checkpoints. */
export async function listCheckpoints(name) {
  const result = await requestStream("GET", checkpointsPath(name))
  if (Array.isArray(result)) return result
  return result.checkpoints || []
}

/** GET /v1/cells/{name}/checkpoints/{checkpointId}. */
export function getCheckpoint(name, checkpointId) {
  return requestJson("GET", checkpointPath(name, checkpointId))
}

/** POST /v1/cells/{name}/checkpoints/{checkpointId}/restore (NDJSON stream of progress events). */
export function restoreCheckpoint(name, checkpointId) {
  return requestStream("POST", checkpointRestorePath(name, checkpointId))
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** GET /v1/cells/{name}/fs/read. Returns the file content as bytes. */
export async function readFile(name, { path, workingDir }) {
  const { buffer } = await cellsFetchBuffer("GET", fsPath(name, "read"), {
    query: { path, workingDir },
  })
  return buffer
}

/** GET /v1/cells/{name}/fs/list. */
export function listDirectory(name, { path, workingDir }) {
  return requestJson("GET", fsPath(name, "list"), { query: { path, workingDir } })
}

/** PUT /v1/cells/{name}/fs/write with the content as the raw body. */
export function writeFile(name, { path, workingDir, mode, mkdir }, content) {
  return requestJson("PUT", fsPath(name, "write"), {
    query: { path, workingDir, mode, mkdir: mkdir ? "true" : undefined },
    rawBody: content,
  })
}

/** DELETE /v1/cells/{name}/fs/delete. */
export function deleteFile(name, { path, workingDir, recursive }) {
  return requestJson("DELETE", fsPath(name, "delete"), {
    body: { path, workingDir, ...(recursive ? { recursive: true } : {}) },
  })
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** GET /v1/cells/{name}/services. Each entry carries its running state under `state`. */
export function listServices(name) {
  return requestJson("GET", servicesPath(name))
}

/** GET /v1/cells/{name}/services/{service}. */
export function getService(name, service) {
  return requestJson("GET", servicePath(name, service))
}

/**
 * PUT /v1/cells/{name}/services/{service}: create or update the definition. The gateway streams the
 * definition's first start, so the answer is an event stream (started, stdout, complete).
 *
 * @param {object} definition - { cmd, args, needs, dir?, env?, http_port? }
 */
export function defineService(name, service, definition) {
  return requestStream("PUT", servicePath(name, service), { body: definition })
}

/** POST /v1/cells/{name}/services/{service}/start (NDJSON stream). */
export function startService(name, service, { duration } = {}) {
  return requestStream("POST", serviceActionPath(name, service, "start"), {
    query: { duration },
  })
}

/** POST /v1/cells/{name}/services/{service}/stop (NDJSON stream: stopping, stopped, complete). */
export function stopService(name, service) {
  return requestStream("POST", serviceActionPath(name, service, "stop"))
}

/** POST /v1/cells/{name}/services/{service}/restart (NDJSON stream). */
export function restartService(name, service) {
  return requestStream("POST", serviceActionPath(name, service, "restart"))
}

/** GET /v1/cells/{name}/services/{service}/logs. Returns the body text. */
export async function getServiceLogs(name, service, { lines } = {}) {
  const { text } = await cellsFetch("GET", serviceActionPath(name, service, "logs"), {
    query: { lines },
  })
  return text
}
