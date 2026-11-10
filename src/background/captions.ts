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
 * Marks the newest line that was on screen when the glasses were cleared, so
 * those old lines stay hidden afterwards. Uses the bridge's time stamp `t`
 * (phone clock, keeps rising across bridge restarts) and falls back to the line
 * id, which the bridge resets to 0 every time captions restart.
 * -1 means "nothing hidden".
 */
export interface HiddenMark {
  t: number
  id: number
}

export const NOTHING_HIDDEN: HiddenMark = {t: -1, id: -1}

/** The mark that hides every line currently in `c`. */
export function markAll(c: BridgeCaption | null): HiddenMark {
  const mark = {t: -1, id: -1}
  for (const l of c?.lines ?? []) {
    if (typeof l?.t === "number" && l.t > mark.t) mark.t = l.t
    if (typeof l?.id === "number" && l.id > mark.id) mark.id = l.id
  }
  return mark
}

/** True when `line` was already on screen before the last clear. */
export function isHidden(line: BridgeLine, mark: HiddenMark | undefined): boolean {
  if (!mark) return false
  if (mark.t >= 0 && typeof line.t === "number") return line.t <= mark.t
  return mark.id >= 0 && typeof line.id === "number" && line.id <= mark.id
}

/**
 * False when the feed shows the bridge restarted since the mark was made
 * (line ids went backwards and there are no time stamps to go by), so the mark
 * would wrongly hide new lines.
 */
export function markStillValid(c: BridgeCaption, mark: HiddenMark): boolean {
  if (mark.id < 0 && mark.t < 0) return true
  const lines = c.lines ?? []
  if (lines.some((l) => typeof l?.t === "number") && mark.t >= 0) return true
  const maxId = markAll(c).id
  return lines.length === 0 || maxId >= mark.id
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
  opts: {live: boolean; maxRows: number; charsPerRow: number; hidden?: HiddenMark},
): string[] {
  const lines = (caption.lines ?? []).filter(
    (l) => typeof l?.text === "string" && !isHidden(l, opts.hidden),
  )
  let text = lines.map((l) => l.text.trim()).join(" ")
  if (opts.live && caption.partial && caption.partial.trim()) {
    text += " " + caption.partial.trim()
  }
  const rows = wrap(text, Math.max(8, opts.charsPerRow))
  return rows.slice(-Math.max(1, opts.maxRows))
}
