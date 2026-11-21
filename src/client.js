/**
 * Cells gateway client.
 *
 * Every request goes to the gateway base URL (default https://cells-api.mudbase.dev, override with CELLS_API_URL)
 * under /v1/cells, with `Authorization: Bearer cells_...`. Route shapes come from the Cells OpenAPI spec
 * (mudbase-cells-docs openapi/cells-openapi.yaml). Three response kinds exist:
 *   - JSON: most reads and writes.
 *   - NDJSON stream: checkpoint create, checkpoint restore and service start. Each line is one event; a
 *     line with type "error" fails the call.
 *   - Plain body: exec (the body is the command output; the exit status is the x-cells-exit-code header).
 */

import { getConfig } from "./config.js"

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

const seg = (value) => encodeURIComponent(String(value))

/**
 * Build a request URL. A query value that is an array repeats its key (used by exec `cmd`, `env`).
 * Null and undefined values are dropped.
 */
export function buildUrl(path, query) {
  const { apiUrl } = getConfig()
  const url = new URL(`${apiUrl}${path}`)
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) url.searchParams.append(key, String(item))
  }
  return url.toString()
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

/**
 * Send one request. Returns { status, headers, text } for a 2xx answer and throws CellsApiError otherwise.
 *
 * @param {string} method
 * @param {string} path - path under the gateway base, starting with /v1/cells or /v1/usage
 * @param {object} [opts]
 * @param {object} [opts.query] - query values; arrays repeat the key
 * @param {object} [opts.body] - JSON body
 * @param {string} [opts.rawBody] - raw octet-stream body (file writes)
 */
export async function cellsFetch(method, path, { query, body, rawBody } = {}) {
  const { apiKey } = getConfig()
  if (!apiKey) {
    throw new CellsApiError("API key required (set CELLS_API_KEY or apiKey in ~/.cells/config.json)")
  }

  const headers = { Authorization: `Bearer ${apiKey}` }
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

  const text = await res.text()
  if (!res.ok) throw errorFromResponse(res.status, res.headers, text)
  return { status: res.status, headers: res.headers, text }
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

async function requestJson(method, path, opts) {
  const { text } = await cellsFetch(method, path, opts)
  return parseBody(text)
}

async function requestNdjson(method, path, opts) {
  const { text } = await cellsFetch(method, path, opts)
  const events = parseNdjson(text)
  const failure = events.find((event) => event && event.type === "error")
  if (failure) {
    throw new CellsApiError(failure.error || "Stream reported an error", {
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
  return requestJson("POST", "/v1/cells", { body })
}

/** GET /v1/cells. */
export function listCells({ prefix, maxResults, continuationToken } = {}) {
  return requestJson("GET", "/v1/cells", {
    query: { prefix, max_results: maxResults, continuation_token: continuationToken },
  })
}

/** GET /v1/cells/{name}. */
export function getCell(name) {
  return requestJson("GET", `/v1/cells/${seg(name)}`)
}

/** DELETE /v1/cells/{name}. */
export async function deleteCell(name) {
  const { status } = await cellsFetch("DELETE", `/v1/cells/${seg(name)}`)
  return { status }
}

/** GET /v1/usage: the caller's usage and limits for the current billing period. */
export function getUsage() {
  return requestJson("GET", "/v1/usage")
}

// ---------------------------------------------------------------------------
// Exec
// ---------------------------------------------------------------------------

/**
 * POST /v1/cells/{name}/exec. `cmd` is the command and its arguments, one entry per argument.
 * `env` entries are KEY=VALUE strings. Returns the output body and the exit code from the
 * x-cells-exit-code header (null when the header is absent or not an integer, for example a gateway refusal).
 */
export async function execCell(name, { cmd, dir, env } = {}) {
  const { headers, text } = await cellsFetch("POST", `/v1/cells/${seg(name)}/exec`, {
    query: { cmd, dir, env },
  })
  const raw = headers.get("x-cells-exit-code")
  const exitCode = raw !== null && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : null
  return { output: text, exitCode }
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/** POST /v1/cells/{name}/checkpoint (NDJSON stream). */
export function createCheckpoint(name, comment) {
  return requestNdjson("POST", `/v1/cells/${seg(name)}/checkpoint`, {
    body: comment ? { comment } : {},
  })
}

/** GET /v1/cells/{name}/checkpoints. */
export function listCheckpoints(name) {
  return requestJson("GET", `/v1/cells/${seg(name)}/checkpoints`)
}

/** GET /v1/cells/{name}/checkpoints/{checkpointId}. */
export function getCheckpoint(name, checkpointId) {
  return requestJson("GET", `/v1/cells/${seg(name)}/checkpoints/${seg(checkpointId)}`)
}

/** POST /v1/cells/{name}/checkpoints/{checkpointId}/restore (NDJSON stream). */
export function restoreCheckpoint(name, checkpointId) {
  return requestNdjson("POST", `/v1/cells/${seg(name)}/checkpoints/${seg(checkpointId)}/restore`)
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** GET /v1/cells/{name}/fs/read. Returns the file content as text. */
export async function readFile(name, { path, workingDir }) {
  const { text } = await cellsFetch("GET", `/v1/cells/${seg(name)}/fs/read`, {
    query: { path, workingDir },
  })
  return text
}

/** GET /v1/cells/{name}/fs/list. */
export function listDirectory(name, { path, workingDir }) {
  return requestJson("GET", `/v1/cells/${seg(name)}/fs/list`, { query: { path, workingDir } })
}

/** PUT /v1/cells/{name}/fs/write with the content as the raw body. */
export function writeFile(name, { path, workingDir, mode, mkdir }, content) {
  return requestJson("PUT", `/v1/cells/${seg(name)}/fs/write`, {
    query: { path, workingDir, mode, mkdir },
    rawBody: content,
  })
}

/** DELETE /v1/cells/{name}/fs/delete. */
export function deleteFile(name, { path, workingDir, recursive }) {
  return requestJson("DELETE", `/v1/cells/${seg(name)}/fs/delete`, {
    body: { path, workingDir, ...(recursive ? { recursive: true } : {}) },
  })
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

/** GET /v1/cells/{name}/services. */
export function listServices(name) {
  return requestJson("GET", `/v1/cells/${seg(name)}/services`)
}

/** GET /v1/cells/{name}/services/{serviceName}. */
export function getService(name, serviceName) {
  return requestJson("GET", `/v1/cells/${seg(name)}/services/${seg(serviceName)}`)
}

/** POST /v1/cells/{name}/services/{serviceName}/start (NDJSON stream). */
export function startService(name, serviceName, { duration } = {}) {
  return requestNdjson("POST", `/v1/cells/${seg(name)}/services/${seg(serviceName)}/start`, {
    query: { duration },
  })
}

/** POST /v1/cells/{name}/services/{serviceName}/stop. */
export function stopService(name, serviceName) {
  return requestJson("POST", `/v1/cells/${seg(name)}/services/${seg(serviceName)}/stop`)
}

/** POST /v1/cells/{name}/services/{serviceName}/restart. */
export function restartService(name, serviceName) {
  return requestJson("POST", `/v1/cells/${seg(name)}/services/${seg(serviceName)}/restart`)
}

/** GET /v1/cells/{name}/services/{serviceName}/logs. Returns the body text. */
export async function getServiceLogs(name, serviceName, { lines } = {}) {
  const { text } = await cellsFetch("GET", `/v1/cells/${seg(name)}/services/${seg(serviceName)}/logs`, {
    query: { lines },
  })
  return text
}
