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
 * @param {string} [opts.language] - 'python' or 'node' (default: 'python')
 * @param {string} [opts.languageVersion] - e.g. '3.12' or '22' (default: '3.12')
 * @param {number} [opts.timeoutSeconds] - session hard timeout (default: 300)
 * @returns {Promise<{sessionId, wsUrl, token, expiresAt, language, languageVersion, timeoutAt}>}
 */
export async function createSession(projectId, opts = {}) {
  const { language = "python", languageVersion = "3.12", timeoutSeconds = 300 } = opts
  return apiRequest("POST", `/api/sandboxes/projects/${projectId}`, {
    language,
    languageVersion,
    timeoutSeconds,
  })
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
 * Create a snapshot (checkpoint) of a running session's filesystem state.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {object} [opts]
 * @param {string} [opts.label] - Human-readable label for the snapshot
 * @returns {Promise<{snapshotId, label, createdAt, sizeBytes?}>}
 */
export async function createSnapshot(projectId, sessionId, opts = {}) {
  const body = {}
  if (opts.label) body.label = opts.label
  return apiRequest(
    "POST",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/snapshot`,
    body,
  )
}

/**
 * List snapshots for a session.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @returns {Promise<{snapshots: Array<{_id, label, createdAt, sizeBytes?}>}>}
 */
export async function listSnapshots(projectId, sessionId) {
  return apiRequest(
    "GET",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/snapshots`,
  )
}

/**
 * Restore a session from a previously saved snapshot.
 *
 * @param {string} projectId
 * @param {string} sessionId
 * @param {string} snapshotId
 * @returns {Promise<object>} Restored session info
 */
export async function restoreSnapshot(projectId, sessionId, snapshotId) {
  return apiRequest(
    "POST",
    `/api/sandboxes/projects/${projectId}/sessions/${sessionId}/restore`,
    { snapshotId },
  )
}
