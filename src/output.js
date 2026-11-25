/**
 * Output helpers shared by the commands.
 */

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2))
}

/** Print rows as a fixed-width table. columns: [{ header, get(row) }]. */
export function printTable(columns, rows) {
  const cell = (value) => (value === undefined || value === null ? "" : String(value))
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => cell(col.get(row)).length))
  )
  const line = (values) => values.map((value, i) => value.padEnd(widths[i])).join("  ").trimEnd()
  console.log(line(columns.map((col) => col.header)))
  for (const row of rows) console.log(line(columns.map((col) => cell(col.get(row)))))
}

/** Read all of stdin as bytes (used when a file write has no --from). */
export async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/** Event types whose payload is program output and is written as it is. */
const OUTPUT_EVENTS = new Set(["stdout", "stderr"])

/**
 * Replace the backend's own word for a cell in control copy with the Cells word (singular and plural, with
 * the same capitalisation). The gateway maps its own error copy this way, but a progress event's payload is
 * passed through as data, so a checkpoint's advice line can still name the backend's vocabulary. Program
 * output is never passed through this function.
 */
/** The Cells word for a matched backend word, with the same capitalisation. */
function cellWordFor(word) {
  const base = /s$/i.test(word) ? "cells" : "cell"
  if (word === word.toUpperCase()) return base.toUpperCase()
  if (/^[A-Z]/.test(word)) return base.charAt(0).toUpperCase() + base.slice(1)
  return base
}

export function cellWords(text) {
  return text
    .replace(/\bsprites?\b/gi, cellWordFor)
    .replace(/\bsprite(?=_(?:id|ref)\b)/gi, cellWordFor)
}

/**
 * Print the events of a progress stream (checkpoint create and restore, service define, start, stop and
 * restart). Program output events are written as they are; every other event is printed as
 * "<type>: <message>" from its data (or its exit code), in Cells vocabulary. An event with no message prints
 * its type alone, so the stream never leaks raw backend JSON into the terminal.
 */
export function printEvents(events) {
  for (const event of events) {
    if (!event || typeof event !== "object") continue
    const type = typeof event.type === "string" ? event.type : "event"
    if (OUTPUT_EVENTS.has(type)) {
      const text = typeof event.data === "string" ? event.data : ""
      if (type === "stderr") process.stderr.write(text)
      else process.stdout.write(text)
      continue
    }
    const raw =
      typeof event.data === "string"
        ? event.data
        : typeof event.message === "string"
          ? event.message
          : typeof event.exit_code === "number"
            ? `exit code ${event.exit_code}`
            : ""
    const message = cellWords(raw)
    if (message) console.log(`${type}: ${message}`)
    else console.log(type)
  }
}
