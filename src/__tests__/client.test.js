/**
 * Tests for the Cells gateway client and the CLI commands that use it.
 *
 * A local node:http server stands in for the gateway on a random 127.0.0.1 port, so nothing leaves the machine.
 * Each test configures the reply it needs; every request the client sends is recorded and checked for method,
 * path and the Authorization header. No request may use the X-API-Key header or reach a host other than the
 * mock (the retired api.mudbase.dev and the dead ws.sandbox.mudbase.dev host are asserted absent).
 *
 * Run with: node --test src/__tests__/client.test.js
 */

import { test, describe, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  buildUrl,
  createCell,
  listCells,
  getCell,
  deleteCell,
  getUsage,
  execCell,
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  readFile,
  writeFile,
  deleteFile,
  startService,
  CellsApiError,
  parseNdjson,
} from "../client.js"
import { resolveApiUrl, DEFAULT_API_URL } from "../config.js"

// A well-formed but made-up key. The gateway is the mock below, so it is never sent anywhere real.
const KEY = `cells_0123456789abcdef.${"A".repeat(43)}`
const CLI = fileURLToPath(new URL("../index.js", import.meta.url))
// A path that does not exist, so the CLI never reads a real ~/.cells/config.json during tests.
const NO_HOME = "/nonexistent-cells-cli-test-home"
const ENV_KEYS = ["CELLS_API_URL", "CELLS_API_KEY", "HOME"]

let mock
const saved = {}

function startMock() {
  const seen = []
  const state = { reply: null }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(chunk))
    req.on("end", () => {
      const record = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }
      seen.push(record)
      if (!state.reply) {
        res.writeHead(500, { "content-type": "text/plain" })
        res.end("no reply configured for this test")
        return
      }
      state.reply(record, res)
    })
  })
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, seen, state, url: `http://127.0.0.1:${server.address().port}` })
    )
  )
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers })
  res.end(JSON.stringify(body))
}

const lastRequest = () => mock.seen[mock.seen.length - 1]

function assertBearer(record) {
  assert.equal(record.headers.authorization, `Bearer ${KEY}`)
  assert.equal(record.headers["x-api-key"], undefined, "the retired X-API-Key header must not be sent")
}

/** Run the CLI as a child process against the mock. Resolves with the exit code and output, never rejects. */
function runCli(args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      {
        env: { ...process.env, CELLS_API_URL: mock.url, CELLS_API_KEY: KEY, HOME: NO_HOME },
        timeout: 20000,
      },
      (error, stdout, stderr) => {
        resolve({ code: error ? error.code ?? 1 : 0, stdout, stderr })
      }
    )
  })
}

before(async () => {
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  mock = await startMock()
  process.env.CELLS_API_URL = mock.url
  process.env.CELLS_API_KEY = KEY
})

after(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  await new Promise((resolve) => {
    mock.server.close(resolve)
    mock.server.closeAllConnections()
  })
})

beforeEach(() => {
  mock.seen.length = 0
  mock.state.reply = null
})

describe("base URL", () => {
  test("defaults to the Cells gateway, never the retired API host or the dead websocket host", () => {
    const saveUrl = process.env.CELLS_API_URL
    const saveHome = process.env.HOME
    delete process.env.CELLS_API_URL
    process.env.HOME = NO_HOME
    try {
      const url = buildUrl("/v1/cells", {})
      assert.equal(url, "https://cells-api.mudbase.dev/v1/cells")
      assert.doesNotMatch(url, /api\.mudbase\.dev\/api|ws\.sandbox|sandboxes/)
    } finally {
      process.env.CELLS_API_URL = saveUrl
      process.env.HOME = saveHome
    }
  })

  test("CELLS_API_URL overrides the base and a trailing slash is dropped", () => {
    process.env.CELLS_API_URL = "http://127.0.0.1:9999/"
    try {
      assert.equal(buildUrl("/v1/usage"), "http://127.0.0.1:9999/v1/usage")
    } finally {
      process.env.CELLS_API_URL = mock.url
    }
  })

  test("a config-file apiUrl on the retired host is ignored, a custom one is kept, the env var always wins", () => {
    assert.deepEqual(resolveApiUrl(undefined, "https://api.mudbase.dev"), {
      url: DEFAULT_API_URL,
      ignoredRetired: true,
    })
    assert.deepEqual(resolveApiUrl(undefined, "https://api.mudbase.dev/api/sandboxes"), {
      url: DEFAULT_API_URL,
      ignoredRetired: true,
    })
    assert.deepEqual(resolveApiUrl(undefined, "http://127.0.0.1:8080/"), {
      url: "http://127.0.0.1:8080",
      ignoredRetired: false,
    })
    assert.deepEqual(resolveApiUrl("https://api.mudbase.dev", undefined), {
      url: "https://api.mudbase.dev",
      ignoredRetired: false,
    })
    assert.deepEqual(resolveApiUrl(undefined, undefined), { url: DEFAULT_API_URL, ignoredRetired: false })
  })

  test("repeated query keys are sent once per value and null values are dropped", () => {
    const url = new URL(buildUrl("/v1/cells/c/exec", { cmd: ["python3", "-c"], dir: undefined, env: null }))
    assert.deepEqual(url.searchParams.getAll("cmd"), ["python3", "-c"])
    assert.equal(url.searchParams.has("dir"), false)
    assert.equal(url.searchParams.has("env"), false)
  })
})

describe("cell routes: method, path and Bearer auth", () => {
  test("createCell POSTs the name to /v1/cells", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 201, { name: "my-cell", id: "cell-1", status: "cold" })
    const cell = await createCell({ name: "my-cell" })
    assert.equal(cell.name, "my-cell")
    assert.equal(lastRequest().method, "POST")
    assert.equal(lastRequest().url, "/v1/cells")
    assert.deepEqual(JSON.parse(lastRequest().body), { name: "my-cell" })
    assertBearer(lastRequest())
  })

  test("listCells GETs /v1/cells with prefix, page size and continuation token", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { cells: [], has_more: false })
    await listCells({ prefix: "dev-", maxResults: 20, continuationToken: "abc" })
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells?prefix=dev-&max_results=20&continuation_token=abc")
    assertBearer(lastRequest())
  })

  test("getCell GETs /v1/cells/{name} with the name encoded", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { name: "my cell" })
    await getCell("my cell")
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells/my%20cell")
    assertBearer(lastRequest())
  })

  test("deleteCell DELETEs /v1/cells/{name}", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(204)
      res.end()
    }
    const result = await deleteCell("my-cell")
    assert.equal(result.status, 204)
    assert.equal(lastRequest().method, "DELETE")
    assert.equal(lastRequest().url, "/v1/cells/my-cell")
    assertBearer(lastRequest())
  })

  test("getUsage GETs /v1/usage", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { schema: "mudbase.cells.usage.v2" })
    const usage = await getUsage()
    assert.equal(usage.schema, "mudbase.cells.usage.v2")
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/usage")
    assertBearer(lastRequest())
  })
})

describe("exec, checkpoints, files, services", () => {
  test("execCell POSTs the command as repeated cmd values and returns the plain body and exit code", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "text/plain", "x-cells-exit-code": "3" })
      res.end("hello\n")
    }
    const result = await execCell("my-cell", { cmd: ["python3", "-c", "print(1)"], dir: "/home/cell", env: ["A=1"] })
    assert.deepEqual(result, { output: "hello\n", exitCode: 3 })
    assert.equal(lastRequest().method, "POST")
    const url = new URL(`${mock.url}${lastRequest().url}`)
    assert.equal(url.pathname, "/v1/cells/my-cell/exec")
    assert.deepEqual(url.searchParams.getAll("cmd"), ["python3", "-c", "print(1)"])
    assert.equal(url.searchParams.get("dir"), "/home/cell")
    assert.deepEqual(url.searchParams.getAll("env"), ["A=1"])
    assertBearer(lastRequest())
  })

  test("execCell reports a null exit code when the header is absent", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("")
    }
    const result = await execCell("my-cell", { cmd: ["true"] })
    assert.equal(result.exitCode, null)
  })

  test("createCheckpoint POSTs the comment and parses the NDJSON stream", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" })
      res.end('{"type":"info","message":"snapshotting"}\n{"type":"complete","id":"v7"}\n')
    }
    const events = await createCheckpoint("my-cell", "before deploy")
    assert.equal(events.at(-1).id, "v7")
    assert.equal(lastRequest().method, "POST")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/checkpoint")
    assert.deepEqual(JSON.parse(lastRequest().body), { comment: "before deploy" })
    assertBearer(lastRequest())
  })

  test("an error event in a checkpoint stream fails the call", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" })
      res.end('{"type":"error","error":"Checkpoint failed: disk full"}\n')
    }
    await assert.rejects(createCheckpoint("my-cell"), (err) => {
      assert.ok(err instanceof CellsApiError)
      assert.match(err.message, /disk full/)
      return true
    })
  })

  test("listCheckpoints and restoreCheckpoint use the checkpoint paths", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, [{ id: "v7" }])
    const list = await listCheckpoints("my-cell")
    assert.equal(list[0].id, "v7")
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/checkpoints")
    assertBearer(lastRequest())

    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" })
      res.end('{"type":"complete"}\n')
    }
    await restoreCheckpoint("my-cell", "v7")
    assert.equal(lastRequest().method, "POST")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/checkpoints/v7/restore")
    assertBearer(lastRequest())
  })

  test("readFile GETs fs/read with path and workingDir and returns the text", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" })
      res.end("file body")
    }
    const text = await readFile("my-cell", { path: "notes.txt", workingDir: "/home/cell" })
    assert.equal(text, "file body")
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/fs/read?path=notes.txt&workingDir=%2Fhome%2Fcell")
    assertBearer(lastRequest())
  })

  test("writeFile PUTs the raw content to fs/write as octet-stream", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { success: true })
    await writeFile("my-cell", { path: "a.txt", workingDir: "/home/cell", mkdir: true }, "hi there")
    assert.equal(lastRequest().method, "PUT")
    assert.equal(lastRequest().headers["content-type"], "application/octet-stream")
    assert.equal(lastRequest().body, "hi there")
    assert.match(lastRequest().url, /^\/v1\/cells\/my-cell\/fs\/write\?/)
    assert.match(lastRequest().url, /mkdir=true/)
    assertBearer(lastRequest())
  })

  test("deleteFile DELETEs fs/delete with a JSON body", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { success: true })
    await deleteFile("my-cell", { path: "tmp", workingDir: "/home/cell", recursive: true })
    assert.equal(lastRequest().method, "DELETE")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/fs/delete")
    assert.deepEqual(JSON.parse(lastRequest().body), { path: "tmp", workingDir: "/home/cell", recursive: true })
    assertBearer(lastRequest())
  })

  test("startService POSTs to services/{name}/start with duration", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "application/x-ndjson" })
      res.end('{"type":"complete"}\n')
    }
    await startService("my-cell", "web", { duration: 30 })
    assert.equal(lastRequest().method, "POST")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/services/web/start?duration=30")
    assertBearer(lastRequest())
  })

  test("parseNdjson rejects a malformed line", () => {
    assert.throws(() => parseNdjson('{"ok":true}\nnot json'), CellsApiError)
  })
})

describe("error mapping", () => {
  test("401 maps to an invalid-key message with status 401", async () => {
    mock.state.reply = (rec, res) =>
      sendJson(res, 401, { error: "unauthorized", message: "A valid Cells API key is required" }, { "www-authenticate": "Bearer" })
    await assert.rejects(listCells(), (err) => {
      assert.equal(err.status, 401)
      assert.match(err.message, /Invalid or missing API key/)
      return true
    })
  })

  test("404 maps to the gateway message with status 404", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 404, { error: "not_found", message: "Cell not found" })
    await assert.rejects(getCell("missing"), (err) => {
      assert.equal(err.status, 404)
      assert.equal(err.code, "not_found")
      assert.equal(err.message, "Cell not found")
      return true
    })
  })

  test("429 carries the Retry-After seconds and the concurrency code", async () => {
    mock.state.reply = (rec, res) =>
      sendJson(
        res,
        429,
        { error: "concurrency_limit_reached", message: "Concurrent cell limit reached", retry_after_seconds: 5 },
        { "retry-after": "5" }
      )
    await assert.rejects(createCell({ name: "busy" }), (err) => {
      assert.equal(err.status, 429)
      assert.equal(err.code, "concurrency_limit_reached")
      assert.equal(err.retryAfter, 5)
      assert.match(err.message, /retry after 5s/)
      return true
    })
  })

  test("403 keeps the limit name and the upgrade link", async () => {
    mock.state.reply = (rec, res) =>
      sendJson(res, 403, {
        error: "cpu_hours_exhausted",
        message: "CPU allowance used for this period",
        upgrade_url: "https://mudbase.dev/pricing",
      })
    await assert.rejects(execCell("my-cell", { cmd: ["true"] }), (err) => {
      assert.equal(err.status, 403)
      assert.match(err.message, /cpu_hours_exhausted/)
      assert.match(err.message, /https:\/\/mudbase\.dev\/pricing/)
      return true
    })
  })
})

describe("no request leaves the gateway, and no X-API-Key is ever sent", () => {
  test("every request goes to the configured base and carries no X-API-Key", async () => {
    const realFetch = globalThis.fetch
    const urls = []
    globalThis.fetch = (url, options) => {
      urls.push(String(url))
      return realFetch(url, options)
    }
    try {
      mock.state.reply = (rec, res) => sendJson(res, 200, { cells: [], has_more: false, name: "x" })
      await listCells()
      await getCell("c1")
      await getUsage()
    } finally {
      globalThis.fetch = realFetch
    }
    assert.equal(urls.length, 3)
    for (const url of urls) {
      assert.ok(url.startsWith(`${mock.url}/v1/`), `unexpected request target: ${url}`)
      assert.doesNotMatch(url, /api\.mudbase\.dev|ws\.sandbox|sandboxes/)
    }
    for (const record of mock.seen) assertBearer(record)
  })
})

describe("CLI commands wire to the gateway routes", () => {
  test("cells list", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { cells: [{ name: "a", status: "warm" }], has_more: false })
    const result = await runCli(["list"])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /NAME/)
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells")
    assertBearer(lastRequest())
  })

  test("cells create my-cell", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 201, { name: "my-cell", id: "cell-1", status: "cold" })
    const result = await runCli(["create", "my-cell"])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(lastRequest().method, "POST")
    assert.equal(lastRequest().url, "/v1/cells")
    assert.deepEqual(JSON.parse(lastRequest().body), { name: "my-cell" })
    assertBearer(lastRequest())
  })

  test("cells get and cells delete", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { name: "my-cell", id: "cell-1", status: "warm" })
    let result = await runCli(["get", "my-cell"])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells/my-cell")
    assertBearer(lastRequest())

    mock.state.reply = (rec, res) => {
      res.writeHead(204)
      res.end()
    }
    result = await runCli(["delete", "my-cell"])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(lastRequest().method, "DELETE")
    assert.equal(lastRequest().url, "/v1/cells/my-cell")
    assertBearer(lastRequest())
  })

  test("cells usage", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, { schema: "mudbase.cells.usage.v2" })
    const result = await runCli(["usage"])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/usage")
    assertBearer(lastRequest())
  })

  test("cells exec passes the command and exits with the gateway exit status", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "text/plain", "x-cells-exit-code": "7" })
      res.end("out-line\n")
    }
    const result = await runCli(["exec", "my-cell", "--", "sh", "-c", "exit 7"])
    assert.equal(result.code, 7, result.stderr)
    assert.equal(result.stdout, "out-line\n")
    assert.equal(lastRequest().method, "POST")
    const url = new URL(`${mock.url}${lastRequest().url}`)
    assert.equal(url.pathname, "/v1/cells/my-cell/exec")
    assert.deepEqual(url.searchParams.getAll("cmd"), ["sh", "-c", "exit 7"])
    assertBearer(lastRequest())
  })

  test("cells files read", async () => {
    mock.state.reply = (rec, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" })
      res.end("hello")
    }
    const result = await runCli(["files", "read", "my-cell", "a.txt", "--working-dir", "/home/cell"])
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, "hello")
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/fs/read?path=a.txt&workingDir=%2Fhome%2Fcell")
    assertBearer(lastRequest())
  })

  test("cells checkpoint list", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 200, [{ id: "v7", comment: "x", create_time: "2026-01-05T10:30:00Z" }])
    const result = await runCli(["checkpoint", "list", "my-cell"])
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /v7/)
    assert.equal(lastRequest().method, "GET")
    assert.equal(lastRequest().url, "/v1/cells/my-cell/checkpoints")
    assertBearer(lastRequest())
  })

  test("cells exits 1 with an Error line on a gateway refusal", async () => {
    mock.state.reply = (rec, res) => sendJson(res, 401, { error: "unauthorized", message: "A valid Cells API key is required" })
    const result = await runCli(["list"])
    assert.equal(result.code, 1)
    assert.match(result.stderr, /^Error: Invalid or missing API key/m)
  })
})
