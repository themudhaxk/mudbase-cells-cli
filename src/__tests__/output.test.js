/**
 * Unit tests for the output helpers, in particular the Cells-vocabulary mapping used on progress events.
 *
 * Run with: node --test src/__tests__/output.test.js
 */

import { describe, it } from "node:test"
import assert from "node:assert/strict"

import { cellWords, stripEscapes } from "../output.js"

describe("cellWords", () => {
  it("maps the backend's word for a cell in lower case", () => {
    assert.equal(cellWords("sprite checkpoint restore v2"), "cell checkpoint restore v2")
    assert.equal(cellWords("sprites are warm"), "cells are warm")
  })

  it("keeps the capitalisation of the original word", () => {
    assert.equal(cellWords("Sprite not found"), "Cell not found")
    assert.equal(cellWords("SPRITE_ID"), "CELL_ID")
    assert.equal(cellWords("Sprites notes"), "Cells notes")
  })

  it("maps every occurrence and leaves other words alone", () => {
    assert.equal(cellWords("sprite, sprite, sprites"), "cell, cell, cells")
    assert.equal(cellWords("a sprite-like word"), "a cell-like word")
    assert.equal(cellWords("no backend word here"), "no backend word here")
  })

  it("does not touch a word that merely contains the letters", () => {
    assert.equal(cellWords("sprightly"), "sprightly")
  })
})

describe("stripEscapes", () => {
  const payloads = [
    "\x1b[2J",
    "\x1b]8;;https://evil.example\x07LINK\x1b]8;;\x07",
    "\x1b]52;c;SGVsbG8=\x07",
  ]

  it("removes the three escape payloads so no ESC byte remains", () => {
    for (const payload of payloads) {
      const cleaned = stripEscapes(`a${payload}b`)
      assert.equal(cleaned.includes("\x1b"), false)
      assert.equal(cleaned.includes("evil.example"), false)
      assert.equal(cleaned.includes("SGVsbG8"), false)
    }
  })

  it("keeps ordinary text and newlines", () => {
    assert.equal(stripEscapes("SERVICE_LOG_LINE\n"), "SERVICE_LOG_LINE\n")
  })

  it("removes bare C0 controls but keeps newline and tab", () => {
    assert.equal(stripEscapes("a\rb\x07c\x08d\te\nf\x7f"), "abcd\te\nf")
  })
})
