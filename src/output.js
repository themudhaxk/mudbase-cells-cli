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

/** Read all of stdin as text (used when a file write has no --from). */
export async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}
