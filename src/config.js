/**
 * CLI configuration management.
 *
 * Reads from (in priority order):
 *   1. Environment variables: CELLS_API_KEY, CELLS_API_URL
 *   2. Config file at ~/.cells/config.json
 *
 * Config file format:
 *   {
 *     "apiKey": "cells_<16 hex>.<43 base64url characters>",
 *     "apiUrl": "https://cells-api.mudbase.dev"
 *   }
 *
 * The config is read on every call (no module cache), so a changed environment or file is always seen.
 */

import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

export const DEFAULT_API_URL = "https://cells-api.mudbase.dev"

export function configPath() {
  return join(homedir(), ".cells", "config.json")
}

function readConfigFile() {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8"))
  } catch {
    return {}
  }
}

/** Hosts that the old 1.0.0 CLI used. They do not serve Cells, so a config file must not point the CLI at them. */
export const RETIRED_API_HOSTS = ["api.mudbase.dev"]

/**
 * Pick the gateway base URL. CELLS_API_URL always wins. A config-file apiUrl that points at a retired host
 * (left over from the 1.0.0 CLI) is ignored and the default is used; `ignoredRetired` tells the caller to warn.
 */
export function resolveApiUrl(envUrl, fileUrl) {
  if (envUrl) return { url: envUrl.replace(/\/+$/, ""), ignoredRetired: false }
  if (!fileUrl) return { url: DEFAULT_API_URL, ignoredRetired: false }
  let host = null
  try {
    host = new URL(fileUrl).hostname
  } catch {
    host = null
  }
  if (host !== null && RETIRED_API_HOSTS.includes(host)) {
    return { url: DEFAULT_API_URL, ignoredRetired: true }
  }
  return { url: fileUrl.replace(/\/+$/, ""), ignoredRetired: false }
}

let warnedRetired = false

export function getConfig() {
  const file = readConfigFile()
  const { url, ignoredRetired } = resolveApiUrl(process.env.CELLS_API_URL, file.apiUrl)
  if (ignoredRetired && !warnedRetired) {
    warnedRetired = true
    process.stderr.write(
      `Warning: ignoring apiUrl ${file.apiUrl} in ${configPath()} (retired host); using ${DEFAULT_API_URL}. ` +
        "Remove apiUrl from the config file to silence this.\n"
    )
  }
  return {
    apiKey: process.env.CELLS_API_KEY || file.apiKey || null,
    apiUrl: url,
  }
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
