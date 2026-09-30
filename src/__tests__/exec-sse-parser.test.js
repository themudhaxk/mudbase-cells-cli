/**
 * Unit tests for the SSE block parser and quota-error helpers in exec.js.
 *
 * Uses Node.js built-in test runner (node:test), available in Node >= 18.
 * Run with: node --test src/__tests__/exec-sse-parser.test.js
 *
 * Covers:
 *   - Keepalive comment blocks return null (are ignored).
 *   - Normal named data blocks parse correctly.
 *   - Mixed comment+data blocks parse correctly.
 *   - HTTP 402 / 429 map to plain quota-limit messages.
 *   - Other status codes return null from quotaErrorMessage.
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { parseSseBlock, quotaErrorMessage } from "../commands/exec.js"

describe("parseSseBlock", () => {
  describe("keepalive comment blocks are ignored", () => {
    it("returns null for a bare colon keepalive line", () => {
      assert.strictEqual(parseSseBlock(": keepalive"), null)
    })

    it("returns null for a colon-only line", () => {
      assert.strictEqual(parseSseBlock(":"), null)
    })

    it("returns null for a block that contains only comment lines", () => {
      assert.strictEqual(parseSseBlock(": keepalive\n: keepalive"), null)
    })

    it("returns null for an empty block", () => {
      assert.strictEqual(parseSseBlock(""), null)
    })
  })

  describe("normal data blocks parse correctly", () => {
    it("parses a stdout event with data", () => {
      const block = 'event: stdout\ndata: {"data":"aGVsbG8="}'
      const result = parseSseBlock(block)
      assert.notStrictEqual(result, null)
      assert.strictEqual(result.eventType, "stdout")
      assert.strictEqual(result.dataLine, '{"data":"aGVsbG8="}')
    })

    it("parses an exit event", () => {
      const block = 'event: exit\ndata: {"code":0}'
      const result = parseSseBlock(block)
      assert.notStrictEqual(result, null)
      assert.strictEqual(result.eventType, "exit")
      assert.strictEqual(result.dataLine, '{"code":0}')
    })

    it("parses a data-only block with no event line", () => {
      const block = 'data: {"code":1}'
      const result = parseSseBlock(block)
      assert.notStrictEqual(result, null)
      assert.strictEqual(result.eventType, "")
      assert.strictEqual(result.dataLine, '{"code":1}')
    })
  })

  describe("mixed blocks with comment and data lines", () => {
    it("extracts the data line and ignores the comment", () => {
      const block = ': keepalive\nevent: stdout\ndata: {"data":"aGk="}'
      const result = parseSseBlock(block)
      assert.notStrictEqual(result, null)
      assert.strictEqual(result.eventType, "stdout")
      assert.strictEqual(result.dataLine, '{"data":"aGk="}')
    })
  })
})

describe("quotaErrorMessage", () => {
  it("maps 402 to a monthly-allowance upgrade message", () => {
    const msg = quotaErrorMessage(402)
    assert.notStrictEqual(msg, null)
    assert.match(msg, /allowance/i)
    assert.match(msg, /upgrade/i)
  })

  it("maps 429 to a concurrent-limit message", () => {
    const msg = quotaErrorMessage(429)
    assert.notStrictEqual(msg, null)
    assert.match(msg, /concurrent/i)
  })

  it("returns null for unrelated status codes", () => {
    assert.strictEqual(quotaErrorMessage(400), null)
    assert.strictEqual(quotaErrorMessage(403), null)
    assert.strictEqual(quotaErrorMessage(500), null)
  })
})
