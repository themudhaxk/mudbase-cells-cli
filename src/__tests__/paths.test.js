/**
 * Unit tests for the request path and query builders in src/paths.js.
 *
 * These are pure functions: no network, no config file, no gateway. Every route the CLI calls is built here,
 * so a wrong path fails a test instead of a live request.
 *
 * Run with: node --test src/__tests__/paths.test.js
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import {
  CELLS_PATH,
  USAGE_PATH,
  assertCellName,
  buildQuery,
  cellPath,
  checkpointCreatePath,
  checkpointPath,
  checkpointRestorePath,
  checkpointsPath,
  execPath,
  fsPath,
  hasGlob,
  parseExitCode,
  serviceActionPath,
  servicePath,
  servicesPath,
  wsBaseUrl,
  wsExecUrl,
} from "../paths.js"

describe("cell paths", () => {
  it("uses /v1/cells for the collection and /v1/usage for usage", () => {
    assert.equal(CELLS_PATH, "/v1/cells")
    assert.equal(USAGE_PATH, "/v1/usage")
  })

  it("builds the cell, exec, checkpoint and fs paths", () => {
    assert.equal(cellPath("demo"), "/v1/cells/demo")
    assert.equal(execPath("demo"), "/v1/cells/demo/exec")
    assert.equal(checkpointCreatePath("demo"), "/v1/cells/demo/checkpoint")
    assert.equal(checkpointsPath("demo"), "/v1/cells/demo/checkpoints")
    assert.equal(checkpointPath("demo", "v7"), "/v1/cells/demo/checkpoints/v7")
    assert.equal(checkpointRestorePath("demo", "v7"), "/v1/cells/demo/checkpoints/v7/restore")
    assert.equal(fsPath("demo", "read"), "/v1/cells/demo/fs/read")
    assert.equal(fsPath("demo", "write"), "/v1/cells/demo/fs/write")
  })

  it("builds the service paths", () => {
    assert.equal(servicesPath("demo"), "/v1/cells/demo/services")
    assert.equal(servicePath("demo", "web"), "/v1/cells/demo/services/web")
    assert.equal(serviceActionPath("demo", "web", "start"), "/v1/cells/demo/services/web/start")
    assert.equal(serviceActionPath("demo", "web", "logs"), "/v1/cells/demo/services/web/logs")
  })

  it("encodes every path parameter", () => {
    assert.equal(cellPath("a b/c"), "/v1/cells/a%20b%2Fc")
    assert.equal(checkpointPath("demo", "v 7"), "/v1/cells/demo/checkpoints/v%207")
    assert.equal(servicePath("demo", "web/1"), "/v1/cells/demo/services/web%2F1")
  })
})

describe("buildQuery", () => {
  it("repeats the key of an array value (exec cmd and env)", () => {
    assert.equal(buildQuery({ cmd: ["sh", "-c", "echo hi"], env: ["A=1", "B=2"] }), "cmd=sh&cmd=-c&cmd=echo+hi&env=A%3D1&env=B%3D2")
  })

  it("drops null and undefined values and keeps false and 0", () => {
    assert.equal(buildQuery({ a: null, b: undefined, c: 0, d: false, e: "" }), "c=0&d=false&e=")
  })

  it("returns an empty string for no query", () => {
    assert.equal(buildQuery(), "")
    assert.equal(buildQuery({}), "")
  })
})

describe("WebSocket URLs", () => {
  it("maps https to wss and http to ws and drops trailing slashes", () => {
    assert.equal(wsBaseUrl("https://cells-api.mudbase.dev/"), "wss://cells-api.mudbase.dev")
    assert.equal(wsBaseUrl("http://127.0.0.1:8080"), "ws://127.0.0.1:8080")
  })

  it("builds an interactive exec URL with the command and tty", () => {
    const url = wsExecUrl("https://cells-api.mudbase.dev", "demo", { cmd: ["bash", "-i"] })
    assert.equal(url, "wss://cells-api.mudbase.dev/v1/cells/demo/exec?cmd=bash&cmd=-i&tty=true")
  })

  it("omits tty when it is off and keeps dir and env", () => {
    const url = new URL(wsExecUrl("http://127.0.0.1:8080/", "demo", { cmd: ["sh"], dir: "/tmp", env: ["A=1"], tty: false }))
    assert.equal(url.protocol, "ws:")
    assert.equal(url.pathname, "/v1/cells/demo/exec")
    assert.deepEqual(url.searchParams.getAll("cmd"), ["sh"])
    assert.equal(url.searchParams.get("dir"), "/tmp")
    assert.deepEqual(url.searchParams.getAll("env"), ["A=1"])
    assert.equal(url.searchParams.has("tty"), false)
  })
})

describe("parseExitCode", () => {
  it("reads a decimal status", () => {
    assert.equal(parseExitCode("3"), 3)
    assert.equal(parseExitCode(" 0 "), 0)
    assert.equal(parseExitCode("255"), 255)
  })

  it("returns null for a missing or non-numeric value", () => {
    assert.equal(parseExitCode(null), null)
    assert.equal(parseExitCode(undefined), null)
    assert.equal(parseExitCode("unknown"), null)
    assert.equal(parseExitCode("3.5"), null)
    assert.equal(parseExitCode(""), null)
  })
})

describe("cell names and glob paths", () => {
  it("refuses an empty or whitespace-only cell name and keeps the name it accepts unchanged", () => {
    for (const blank of ["", " ", "\t\n"]) {
      assert.throws(() => assertCellName(blank), /Invalid cell name/)
      assert.throws(() => cellPath(blank), /Invalid cell name/)
    }
    assert.equal(assertCellName("demo"), "demo")
    assert.equal(assertCellName(" demo"), " demo")
  })

  it("flags every glob character, and only those", () => {
    for (const glob of ["*", "/*", "/tmp/*", "a?b", "[ab]", "{a,b}", "x]"]) assert.equal(hasGlob(glob), true, glob)
    for (const plain of ["/", "/tmp/tmp", "notes.txt", "a-b_c.d", ".."]) assert.equal(hasGlob(plain), false, plain)
  })
})
