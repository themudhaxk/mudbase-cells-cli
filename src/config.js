/**
 * CLI configuration management.
 *
 * Reads from (in priority order):
 *   1. Environment variables: CELLS_API_KEY, CELLS_PROJECT_ID, CELLS_API_URL, CELLS_GATEWAY_URL
 *   2. Config file at ~/.cells/config.json
 *
 * Config file format:
 *   {
 *     "apiKey": "sk_...",
 *     "projectId": "<mongodb-objectid>",
 *     "apiUrl": "https://api.mudbase.dev",
 *     "gatewayUrl": "wss://sandbox-gateway.mudbase.dev"
 *   }
 */

import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const CONFIG_PATH = join(homedir(), ".cells", "config.json")

const DEFAULT_API_URL = "https://api.mudbase.dev"
const DEFAULT_GATEWAY_URL = "wss://sandbox-gateway.mudbase.dev"

let _cached = null

function readConfigFile() {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8")
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export function getConfig() {
  if (_cached) return _cached

  const file = readConfigFile()

  _cached = {
    apiKey: process.env.CELLS_API_KEY || file.apiKey || null,
    projectId: process.env.CELLS_PROJECT_ID || file.projectId || null,
    apiUrl: process.env.CELLS_API_URL || file.apiUrl || DEFAULT_API_URL,
    gatewayUrl: process.env.CELLS_GATEWAY_URL || file.gatewayUrl || DEFAULT_GATEWAY_URL,
  }

  return _cached
}

export function requireApiKey() {
  const { apiKey } = getConfig()
  if (!apiKey) {
    console.error(
      "Error: API key required. Set CELLS_API_KEY env var or add apiKey to ~/.cells/config.json"
    )
    process.exit(1)
  }
  return apiKey
}

export function requireProjectId(explicitProjectId) {
  const id = explicitProjectId || getConfig().projectId
  if (!id) {
    console.error(
      "Error: project ID required. Pass --project <id>, set CELLS_PROJECT_ID env var, or add projectId to ~/.cells/config.json"
    )
    process.exit(1)
  }
  return id
}
