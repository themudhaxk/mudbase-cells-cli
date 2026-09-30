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
