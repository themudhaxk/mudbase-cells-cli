/**
 * Unit tests for src/config.js: the API URL, the retired host guard, and env-over-file precedence.
 *
 * The config file is read from $HOME/.cells/config.json, so each test points HOME at its own throwaway
 * directory. Nothing here reaches the network.
 *
 * Run with: node --test src/__tests__/config.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { DEFAULT_API_URL, configPath, getConfig, resolveApiUrl } from "../config.js"

const ENV_KEYS = ["CELLS_API_URL", "CELLS_API_KEY", "HOME"]
let saved
let home

beforeEach(() => {
  saved = {}
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  home = mkdtempSync(join(tmpdir(), "cells-cli-config-"))
  process.env.HOME = home
  delete process.env.CELLS_API_URL
  delete process.env.CELLS_API_KEY
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  rmSync(home, { recursive: true, force: true })
})

function writeConfigFile(value) {
  mkdirSync(join(home, ".cells"), { recursive: true })
  writeFileSync(configPath(), JSON.stringify(value))
}

describe("resolveApiUrl", () => {
  it("defaults to the Cells gateway", () => {
    assert.deepEqual(resolveApiUrl(undefined, undefined), { url: DEFAULT_API_URL, ignoredRetired: false })
    assert.equal(DEFAULT_API_URL, "https://cells-api.mudbase.dev")
  })

  it("always prefers the environment URL and drops trailing slashes", () => {
    assert.deepEqual(resolveApiUrl("https://example.test/", "https://other.test"), {
      url: "https://example.test",
      ignoredRetired: false,
    })
  })

  it("ignores a config file URL on the retired host", () => {
    assert.deepEqual(resolveApiUrl(undefined, "https://api.mudbase.dev"), {
      url: DEFAULT_API_URL,
      ignoredRetired: true,
    })
  })

  it("keeps a custom config file URL", () => {
    assert.deepEqual(resolveApiUrl(undefined, "http://127.0.0.1:8080/"), {
      url: "http://127.0.0.1:8080",
      ignoredRetired: false,
    })
  })

  it("keeps a value that is not a parseable URL as it is", () => {
    assert.deepEqual(resolveApiUrl(undefined, "not a url"), { url: "not a url", ignoredRetired: false })
  })
})

describe("getConfig precedence", () => {
  it("reads nothing when there is no file and no environment", () => {
    const config = getConfig()
    assert.equal(config.apiKey, null)
    assert.equal(config.apiUrl, DEFAULT_API_URL)
  })

  it("reads apiKey and apiUrl from the config file", () => {
    writeConfigFile({ apiKey: "cells_file_key", apiUrl: "http://127.0.0.1:1234" })
    const config = getConfig()
    assert.equal(config.apiKey, "cells_file_key")
    assert.equal(config.apiUrl, "http://127.0.0.1:1234")
  })

  it("lets the environment win over the file", () => {
    writeConfigFile({ apiKey: "cells_file_key", apiUrl: "http://127.0.0.1:1234" })
    process.env.CELLS_API_KEY = "cells_env_key"
    process.env.CELLS_API_URL = "http://127.0.0.1:4321/"
    const config = getConfig()
    assert.equal(config.apiKey, "cells_env_key")
    assert.equal(config.apiUrl, "http://127.0.0.1:4321")
  })

  it("ignores a config file that is not valid JSON", () => {
    mkdirSync(join(home, ".cells"), { recursive: true })
    writeFileSync(configPath(), "{ not json")
    const config = getConfig()
    assert.equal(config.apiKey, null)
    assert.equal(config.apiUrl, DEFAULT_API_URL)
  })
})
