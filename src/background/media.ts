/**
 * Pure helpers for the Media Bridge "now playing" feed (GET :8766/media).
 * No SDK calls here, so this is easy to test on a laptop.
 */

/** The parts of the bridge's /media JSON we use. */
export interface BridgeMedia {
  /** false when the Media switch is off in the bridge app. */
  enabled?: boolean
  playing?: boolean
  /** "playing" | "paused" | "stopped" | "buffering" | "unknown" | "none" */
  state?: string
  app?: string
  title?: string
  artist?: string
  album?: string
  /** ms, or -1 when unknown. A snapshot from the player's last update, not live. */
  position?: number
  /** ms; 0 or -1 for live streams. */
  duration?: number
  live?: boolean
}

/**
 * Keeps a running playback clock. The bridge's position only changes when the
 * player reports it (on play, pause, seek, track change), so between reports we
 * count forward ourselves while playing.
 */
export class MediaClock {
  private basePos = -1
  private baseAt = 0
  private key = ""
  media: BridgeMedia | null = null

  /** Feed each /media response. `now` is Date.now(), passed in for testing. */
  update(m: BridgeMedia | null, now: number): void {
    this.media = m
    if (!m) {
      this.key = ""
      this.basePos = -1
      return
    }
    // Re-base only when the player actually reported something new; otherwise
    // the same stale snapshot would keep pulling the clock backwards.
    const key = [m.state, m.title, m.artist, m.duration, m.position].join("|")
    if (key !== this.key) {
      this.key = key
      this.basePos = typeof m.position === "number" ? m.position : -1
      this.baseAt = now
    }
  }

  /** Current position in ms, or -1 when unknown. */
  positionMs(now: number): number {
    const m = this.media
    if (!m || this.basePos < 0) return -1
    let pos = this.basePos
    if (m.state === "playing") pos += now - this.baseAt
    const dur = typeof m.duration === "number" ? m.duration : -1
    return dur > 0 ? Math.min(pos, dur) : pos
  }
}

/** True when the feed says something is loaded in a player. */
export function hasTrack(m: BridgeMedia | null): m is BridgeMedia {
  return !!m && m.enabled !== false && !!m.state && m.state !== "none"
}

/** Formats ms as m:ss, or h:mm:ss when `hours` is set. */
export function formatTime(ms: number, hours = false): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, "0")
  return hours ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m + h * 60}:${ss}`
}

/** Shortens text to `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  return max <= 1 ? t.slice(0, max) : t.slice(0, max - 1).trimEnd() + "…"
}

export interface TimeBar {
  /** e.g. "▶ 12:34 / 45:10   -32:36" or "● LIVE". */
  text: string
  /** 0..1, or null when there is no fixed length (live streams). */
  progress: number | null
}

/**
 * A text progress bar: "█" for played, "▒" for the rest. These block glyphs
 * render on the G2 (the Even NowPlaying app uses them). They are wider than
 * letters, so `width` should be about half the characters per row.
 */
export function textBar(progress: number, width: number): string {
  const n = Math.max(4, width)
  const filled = Math.round(Math.min(1, Math.max(0, progress)) * n)
  return "█".repeat(filled) + "▒".repeat(n - filled)
}

/**
 * Builds the time row: play state, elapsed / total, and time left.
 * Live streams get a fixed label: a ticking clock there only causes redraws.
 */
export function buildTimeBar(m: BridgeMedia, positionMs: number): TimeBar {
  const icon = m.state === "playing" ? "▶" : m.state === "buffering" ? "…" : "❚❚"
  const dur = typeof m.duration === "number" ? m.duration : -1
  if (m.live || dur <= 0) {
    return {text: m.state === "playing" || m.state === "buffering" ? "● LIVE" : "❚❚ LIVE", progress: null}
  }
  const hours = dur >= 3_600_000
  const pos = Math.max(0, positionMs)
  return {
    text: `${icon} ${formatTime(pos, hours)} / ${formatTime(dur, hours)}   -${formatTime(dur - pos, hours)}`,
    progress: Math.min(1, Math.max(0, pos / dur)),
  }
}

/** The "source" line under the title: artist and app, whichever exist. */
export function sourceLine(m: BridgeMedia): string {
  return [m.artist, m.app].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ")
}
