/**
 * Pure helpers for turning the bridge's caption feed into glasses rows.
 * No SDK calls here, so this is easy to test on a laptop.
 */

/** One line from GET /caption on the Media Bridge app. */
export interface BridgeLine {
  id: number
  text: string
  t?: number
}

/** The parts of the bridge's /caption JSON we use. */
export interface BridgeCaption {
  running?: boolean
  status?: string
  engine?: string
  silentForSec?: number
  seq?: number
  partial?: string
  lines?: BridgeLine[]
}

/** Word-wraps text into rows of at most `width` characters. Long words are split. */
export function wrap(text: string, width: number): string[] {
  const rows: string[] = []
  let row = ""
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    if (!word) continue
    let w = word
    while (w.length > width) {
      if (row) {
        rows.push(row)
        row = ""
      }
      rows.push(w.slice(0, width))
      w = w.slice(width)
    }
    if (!row) row = w
    else if (row.length + 1 + w.length <= width) row += " " + w
    else {
      rows.push(row)
      row = w
    }
  }
  if (row) rows.push(row)
  return rows
}

/**
 * Builds the rows to show: the newest finished lines, plus (in live mode) the
 * words still being recognized, keeping only the last `maxRows` rows.
 *
 * Finished lines are joined as running text, so the glasses read like a
 * continuous transcript instead of one 8-word chunk per row.
 */
export function buildRows(
  caption: BridgeCaption,
  opts: {live: boolean; maxRows: number; charsPerRow: number; afterId?: number},
): string[] {
  const afterId = opts.afterId ?? -1
  const lines = (caption.lines ?? []).filter(
    (l) => typeof l?.text === "string" && !(typeof l.id === "number" && l.id <= afterId),
  )
  let text = lines.map((l) => l.text.trim()).join(" ")
  if (opts.live && caption.partial && caption.partial.trim()) {
    text += " " + caption.partial.trim()
  }
  const rows = wrap(text, Math.max(8, opts.charsPerRow))
  return rows.slice(-Math.max(1, opts.maxRows))
}
