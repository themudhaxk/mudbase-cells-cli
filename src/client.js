/**
 * Mudbase Cells REST API client.
 *
 * Thin fetch wrapper that injects API key auth and handles error responses.
 * All endpoints are under /api/sandboxes on the configured apiUrl.
 */

import { getConfig } from "./config.js"

/**
 * Make an authenticated request to the Mudbase API.
 *
 * @param {string} method - HTTP method
 * @param {string} path - Path under the API base (e.g. /api/sandboxes/projects/:id)
 * @param {object} [body] - Request body (JSON-serialized)
 * @param {string} [apiKey] - Override API key (defaults to config)
 * @returns {Promise<object>} Parsed JSON response body
 */
export async function apiRequest(method, path, body, apiKey) {
  const config = getConfig()
  const key = apiKey || config.apiKey

  const url = `${config.apiUrl}${path}`

  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": key,
  }

  const opts = { method, headers }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(url, opts)
  } catch (err) {
    throw new Error(`Network error: ${err.message}`)
  }

  let data
  const contentType = res.headers.get("content-type") || ""
  if (contentType.includes("application/json")) {
    data = await res.json()
  } else {
    data = await res.text()
  }

  if (!res.ok) {
    const msg = (typeof data === "object" && data?.error) ? data.error : String(data)
    const err = new Error(msg)
    err.status = res.status
    err.body = data
    throw err
  }

  return data
}

/**
 * Create a new sandbox session.
 *
 * @param {string} projectId
 * @param {object} opts
 * @param {string} [opts.language] - 'python', 'javascript', 'go', 'rust', 'php', 'java', 'ruby', 'csharp', or 'bash' (default: 'python')
 * @param {string} [opts.languageVersion] - e.g. '3.12', '22', '1.23', '1.82', '8.3', '21', '3.3', '8.0' (default: '3.12')
 * @param {number} [opts.timeoutSeconds] - session hard timeout in seconds, min 30, max 1800 (default: 300)
 * @param {string} [opts.sizeId] - machine size: micro, small, standard, large, max (default: 'micro')
 * @param {string} [opts.cellName] - named cell for persistent /workspace volume (1-63 alphanumeric/underscore/hyphen)
 * @param {boolean} [opts.alwaysOn] - persist the session after client disconnect (flag-gated, requires Growth+ plan)
 * @param {string} [opts.externalId] - idempotency key for re-attach (printable ASCII, max 128 chars)
 * @returns {Promise<{sessionId, wsUrl, token, expiresAt, language, languageVersion, timeoutAt, publicUrl, resumed?}>}
 */
export async function createSession(projectId, opts = {}) {
  const {
    language = "python",
    languageVersion = "3.12",
    timeoutSeconds = 300,
    sizeId,
    cellName,
    alwaysOn,
    externalId,
  } = opts
  const body = { language, languageVersion, timeoutSeconds }
  if (sizeId !== undefined) body.sizeId = sizeId
  if (cellName !== undefined) body.cellName = cellName
  if (alwaysOn !== undefined) body.alwaysOn = alwaysOn
  if (externalId !== undefined) body.externalId = externalId
  return apiRequest("POST", `/api/sandboxes/projects/${projectId}`, body)
}

/**
 * List running sessions for a project.
 *
 * @param {string} projectId
 * @returns {Promise<{sessions: Array}>}
 */
export async function listSessions(projectId) {
  return apiRequest("GET", `/api/sandboxes/projects/${projectId}`)
}

/**
 * Get a single session's status.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @returns {Promise<{session: object}>}
 */
export async function getSession(projectId, sessionId) {
  return apiRequest("GET", `/api/sandboxes/projects/${projectId}/sessions/${sessionId}`)
}

/**
 * Issue a fresh gateway JWT for an existing session.
 * Used when connecting to a session created more than 60 seconds ago.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @returns {Promise<{token, wsUrl, expiresAt}>}
 */
export async function getConnectToken(projectId, sessionId) {
  return apiRequest(
    "POST",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/connect-token`
  )
}

/**
 * Close a session.
 *
 * @param {string} projectId
 * @param {string} sessionId
 */
export async function closeSession(projectId, sessionId) {
  return apiRequest("DELETE", `/api/sandboxes/projects/${projectId}/sessions/${sessionId}`)
}

/**
 * Create a checkpoint of a running or suspended session's filesystem state.
 * Requires the session to have been created with a cellName (persistent volume).
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.name] - Human-readable label for this checkpoint (max 200 chars)
 * @returns {Promise<{checkpointId, snapshotId, sizeGb, createdAt}>}
 */
export async function createCheckpoint(projectId, sessionId, opts = {}) {
  const body = {}
  if (opts.name) body.name = opts.name
  return apiRequest(
    "POST",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/checkpoint`,
    body,
  )
}

/**
 * List checkpoints for a session, newest first.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @returns {Promise<{checkpoints: Array<{id, snapshotId, name, sizeGb, createdAt, createdBy}>}>}
 */
export async function listCheckpoints(projectId, sessionId) {
  return apiRequest(
    "GET",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/checkpoints`,
  )
}

/**
 * Delete a checkpoint and its underlying volume snapshot.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {string} checkpointId
 * @returns {Promise<{success, checkpointId}>}
 */
export async function deleteCheckpoint(projectId, sessionId, checkpointId) {
  return apiRequest(
    "DELETE",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/checkpoints/${checkpointId}`,
  )
}

/**
 * Start an async restore job from a checkpoint.
 * Poll getRestoreJob until status is "succeeded" or "failed".
 *
 * @param {string} projectId
 * @param {string} sessionId - Source session whose checkpoint is being restored.
 * @param {string} checkpointId
 * @returns {Promise<{restoreId}>}
 */
export async function restoreFromCheckpoint(projectId, sessionId, checkpointId) {
  return apiRequest(
    "POST",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/restore`,
    { checkpointId },
  )
}

/**
 * Poll a restore job for its status.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {string} restoreId
 * @returns {Promise<{restoreId, status, startedAt, completedAt, error, result}>}
 */
export async function getRestoreJob(projectId, sessionId, restoreId) {
  return apiRequest(
    "GET",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/restores/${restoreId}`,
  )
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

/**
 * Write one or more files into a running session's filesystem.
 *
 * Binary content must be base64-encoded and the file entry must include
 * { encoding: "base64" }. Text files may omit encoding (defaults to "text").
 *
 * The server returns HTTP 207 when some files succeeded and others failed.
 * The caller should inspect result.results[] for per-file success/failure.
 * This function treats a 207 as a successful HTTP response and returns the
 * body so the caller can inspect per-file outcomes.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {Array<{path: string, content: string, encoding?: "text"|"base64"}>} files
 * @returns {Promise<{success: boolean, results: Array<{path, success, error?}>}>}
 */
export async function writeFiles(projectId, sessionId, files) {
  const config = getConfig()
  const url = `${config.apiUrl}/api/sandboxes/projects/${projectId}/sessions/${sessionId}/files`

  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": config.apiKey,
  }

  let res
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ files }),
    })
  } catch (err) {
    throw new Error(`Network error: ${err.message}`)
  }

  let data
  try {
    data = await res.json()
  } catch {
    data = {}
  }

  // 207 Multi-Status: some files may have failed. Return the body so callers
  // can inspect individual results; treat it as a non-error response.
  if (!res.ok && res.status !== 207) {
    const msg = (typeof data === "object" && data?.error) ? data.error : `HTTP ${res.status}`
    const err = new Error(msg)
    err.status = res.status
    err.body = data
    throw err
  }

  return data
}

/**
 * Read a single file from a running session's filesystem.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {string} remotePath - Path to read, relative to /workspace
 * @returns {Promise<{success, path, content, encoding, sha256, size}>}
 */
export async function readFile(projectId, sessionId, remotePath) {
  const encodedPath = encodeURIComponent(remotePath)
  return apiRequest(
    "GET",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/files?path=${encodedPath}`,
  )
}

// ---------------------------------------------------------------------------
// Service lifecycle
// ---------------------------------------------------------------------------

/**
 * List services running inside a session.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @returns {Promise<{success, services: Array<{name, status, pid, port?}>}>}
 */
export async function listServices(projectId, sessionId) {
  return apiRequest(
    "GET",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/services`,
  )
}

/**
 * Start a named service inside a session.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {object} opts
 * @param {string} opts.name - Service name (alphanumeric/hyphen/underscore)
 * @param {string[]} opts.cmd - Command to run, e.g. ["python", "app.py"]
 * @param {string[]} [opts.args] - Additional args (can be folded into cmd)
 * @param {string} [opts.cwd] - Working directory (default: /workspace)
 * @param {number} [opts.port] - Port the service listens on
 * @param {boolean} [opts.waitForPort] - Wait until the port is reachable (requires port)
 * @param {number} [opts.timeoutMs] - Max wait time for port readiness in ms (default: 30000)
 * @param {Record<string,string>} [opts.env] - Additional environment variables
 * @returns {Promise<{success, name, status, pid?, port?, publicUrl?}>}
 */
export async function startService(projectId, sessionId, opts) {
  const { name, cmd, args, cwd, port, waitForPort, timeoutMs, env } = opts
  const body = { name, cmd }
  if (args !== undefined) body.args = args
  if (cwd !== undefined) body.cwd = cwd
  if (port !== undefined) body.port = port
  if (waitForPort !== undefined) body.waitForPort = waitForPort
  if (timeoutMs !== undefined) body.timeoutMs = timeoutMs
  if (env !== undefined) body.env = env
  return apiRequest(
    "POST",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/services`,
    body,
  )
}

/**
 * Stop a named service running inside a session. No-op if not running.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {string} name - Service name
 * @returns {Promise<{success}>}
 */
export async function stopService(projectId, sessionId, name) {
  return apiRequest(
    "DELETE",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/services/${encodeURIComponent(name)}`,
  )
}

// ---------------------------------------------------------------------------
// Port exposure
// ---------------------------------------------------------------------------

/**
 * Expose an internal port so the session is reachable from the internet.
 *
 * Returns a publicUrl in the form:
 *   https://sb-{sessionId}-{port}.sandbox.mudbase.dev
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {number} port - Internal port to expose (1-65535)
 * @param {"public"|"token-gated"} [access] - Access control (default: "public")
 * @returns {Promise<{success, port, publicUrl, portToken?}>}
 */
export async function exposePort(projectId, sessionId, port, access = "public") {
  return apiRequest(
    "POST",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/expose`,
    { port, access },
  )
}
