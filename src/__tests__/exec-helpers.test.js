/**
 * Unit tests for the SSE line parser and quota-error helpers in exec.js.
 *
 * Uses Node.js built-in test runner (node:test), available in Node >= 18.
 * Run with: node --test src/__tests__/exec-helpers.test.js
 *
 * Covers:
 *   parseSseLine:
 *   - Comment/keepalive lines (start with ":") return null.
 *   - Lines without "data: " prefix return null.
 *   - "data: stdout:<text>" returns { type: "stdout", text }
 *   - "data: stderr:<text>" returns { type: "stderr", text }
 *   - "data: exit:<code>" returns { type: "exit", code }
 *   - Malformed exit code falls back to 1.
 *   - Unknown data prefix returns null.
 *
 *   quotaErrorMessage:
 *   - HTTP 402 maps to a sandbox-allowance message.
 *   - HTTP 429 maps to a concurrent-session message.
 *   - Other status codes return null.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseSseLine, quotaErrorMessage } from "../commands/exec.js"

// ---------------------------------------------------------------------------
// parseSseLine
// ---------------------------------------------------------------------------

describe("parseSseLine", () => {
  describe("non-data lines return null", () => {
    it("returns null for a keepalive comment line", () => {
      assert.strictEqual(parseSseLine(": keepalive"), null)
    })

    it("returns null for a bare colon keepalive", () => {
      assert.strictEqual(parseSseLine(":"), null)
    })

    it("returns null for an event: line", () => {
      assert.strictEqual(parseSseLine("event: stdout"), null)
    })

    it("returns null for an empty string", () => {
      assert.strictEqual(parseSseLine(""), null)
    })
  })

  describe("stdout lines", () => {
    it("parses a stdout line with text", () => {
      const result = parseSseLine("data: stdout:hello world")
      assert.deepStrictEqual(result, { type: "stdout", text: "hello world" })
    })

    it("parses a stdout line with an empty payload", () => {
      const result = parseSseLine("data: stdout:")
      assert.deepStrictEqual(result, { type: "stdout", text: "" })
    })

    it("preserves colons inside the text", () => {
      const result = parseSseLine("data: stdout:key:value")
      assert.deepStrictEqual(result, { type: "stdout", text: "key:value" })
    })
  })

  describe("stderr lines", () => {
    it("parses a stderr line", () => {
      const result = parseSseLine("data: stderr:error: something went wrong")
      assert.deepStrictEqual(result, { type: "stderr", text: "error: something went wrong" })
    })
  })

  describe("exit lines", () => {
    it("parses an exit code of 0", () => {
      const result = parseSseLine("data: exit:0")
      assert.deepStrictEqual(result, { type: "exit", code: 0 })
    })

    it("parses a non-zero exit code", () => {
      const result = parseSseLine("data: exit:127")
      assert.deepStrictEqual(result, { type: "exit", code: 127 })
    })

    it("falls back to code 1 for a non-numeric exit value", () => {
      const result = parseSseLine("data: exit:NaN")
      assert.deepStrictEqual(result, { type: "exit", code: 1 })
    })
  })

  describe("unknown data prefix returns null", () => {
    it("returns null for an unrecognised prefix", () => {
      assert.strictEqual(parseSseLine("data: unknown:something"), null)
    })
  })
})

// ---------------------------------------------------------------------------
// quotaErrorMessage
// ---------------------------------------------------------------------------

describe("quotaErrorMessage", () => {
  it("returns an allowance message for HTTP 402", () => {
    const msg = quotaErrorMessage(402)
    assert.ok(typeof msg === "string" && msg.length > 0)
    assert.ok(msg.includes("allowance") || msg.includes("upgrade") || msg.includes("plan"))
  })

  it("returns a concurrent-session message for HTTP 429", () => {
    const msg = quotaErrorMessage(429)
    assert.ok(typeof msg === "string" && msg.length > 0)
    assert.ok(msg.includes("Concurrent") || msg.includes("concurrent") || msg.includes("session"))
  })

  it("returns null for HTTP 400", () => {
    assert.strictEqual(quotaErrorMessage(400), null)
  })

  it("returns null for HTTP 401", () => {
    assert.strictEqual(quotaErrorMessage(401), null)
  })

  it("returns null for HTTP 403", () => {
    assert.strictEqual(quotaErrorMessage(403), null)
  })

  it("returns null for HTTP 500", () => {
    assert.strictEqual(quotaErrorMessage(500), null)
  })
})
