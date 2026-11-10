/**
 * Background (glasses) side of Media Bridge Captions.
 *
 * Checks the TakeMotions Media Bridge Android app on a timer:
 *   - captions:     http://127.0.0.1:8767/caption
 *   - now playing:  http://127.0.0.1:8766/media
 * and draws the track title and source, captions, and a time bar on the
 * glasses. Runs whenever the Mentra app is alive, whether or not the phone
 * settings screen is open.
 */

import {registerMiniapp, type UIModule} from "@mentra/miniapp/background"
import type {RenderElement} from "@mentra/miniapp"
import {
  DEFAULT_SETTINGS,
  type BridgeStatus,
  type Channels,
  type Settings,
  type State,
  type Stats,
} from "../shared/channels"
import {buildRows, type BridgeCaption} from "./captions"
import {
  MediaClock,
  buildTimeBar,
  hasTrack,
  sourceLine,
  truncate,
  type BridgeMedia,
} from "./media"

const SETTINGS_KEY = "settings"
const FETCH_TIMEOUT_MS = 2000
const MEDIA_POLL_MS = 1000

// Layout, in device pixels. The Even NowPlaying app spaces G2 text rows ~36 px apart.
const ROW_H = 36
const BAR_H = 10
const BAR_GAP = 4

/** After pausing, keep the title and time bar up this long, then clear. */
const PAUSED_INFO_MS = 30_000

/** Everything that can be on the glasses. Empty strings mean "leave it out". */
interface Scene {
  title: string
  source: string
  captions: string
  time: string
  /** 0..1, or null for no progress bar. */
  progress: number | null
}

const EMPTY_SCENE: Scene = {title: "", source: "", captions: "", time: "", progress: null}

/** Keeps values from the settings screen within sane bounds. */
function clampSettings(s: Settings): Settings {
  const clamp = (v: number, lo: number, hi: number, d: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d
  const url = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d)
  return {
    enabled: s.enabled !== false,
    mode: s.mode === "lines" ? "lines" : "live",
    pollMs: clamp(s.pollMs, 100, 5000, DEFAULT_SETTINGS.pollMs),
    minRenderMs: clamp(s.minRenderMs, 0, 5000, DEFAULT_SETTINGS.minRenderMs),
    rows: clamp(s.rows, 1, 8, DEFAULT_SETTINGS.rows),
    charsPerRow: clamp(s.charsPerRow, 10, 80, DEFAULT_SETTINGS.charsPerRow),
    clearAfterSec: clamp(s.clearAfterSec, 0, 120, DEFAULT_SETTINGS.clearAfterSec),
    showTrackInfo: s.showTrackInfo !== false,
    showTimeBar: s.showTimeBar !== false,
    bridgeUrl: url(s.bridgeUrl, DEFAULT_SETTINGS.bridgeUrl),
    mediaUrl: url(s.mediaUrl, DEFAULT_SETTINGS.mediaUrl),
  }
}

/** fetch() with a timeout. AbortController is only partly available in the background engine. */
async function fetchJson(url: string): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  try {
    controller = typeof AbortController === "function" ? new AbortController() : null
  } catch {
    controller = null
  }
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller?.abort()
      } catch {
        // ignore
      }
      reject(new Error(`timed out after ${FETCH_TIMEOUT_MS} ms`))
    }, FETCH_TIMEOUT_MS)
  })
  try {
    const res = await Promise.race([
      fetch(url, controller ? {signal: controller.signal} : undefined),
      timeout,
    ])
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** A 20-character text version of the progress bar, for the phone preview. */
function previewBar(p: number): string {
  const filled = Math.round(p * 20)
  return "[" + "■".repeat(filled) + "□".repeat(20 - filled) + "]"
}

registerMiniapp(async (session) => {
  const ui = session.ui as unknown as UIModule<Channels>

  // ---- settings ----------------------------------------------------------
  let settings: Settings = {...DEFAULT_SETTINGS}
  try {
    const raw = await session.storage.get(SETTINGS_KEY)
    if (raw) settings = clampSettings({...DEFAULT_SETTINGS, ...JSON.parse(raw)})
  } catch (e) {
    console.warn("settings load failed", e)
  }

  async function saveSettings() {
    try {
      await session.storage.set(SETTINGS_KEY, JSON.stringify(settings))
    } catch (e) {
      console.warn("settings save failed", e)
    }
  }

  const mediaWanted = () => settings.showTrackInfo || settings.showTimeBar

  // ---- stats (shown on the phone screen) ---------------------------------
  const stats: Stats = {
    status: settings.enabled ? "connecting" : "paused",
    lastError: null,
    polls: 0,
    failures: 0,
    lastFetchMs: null,
    seq: -1,
    renders: 0,
    lastRenderStatus: null,
    lastRenderDegraded: false,
    silentForSec: 0,
    engine: "",
    display: null,
    preview: "",
    mediaStatus: mediaWanted() ? "unreachable" : "unused",
    mediaError: null,
  }

  function pushState() {
    if (!ui.isOpen()) return
    const state: State = {settings: {...settings}, stats: {...stats}}
    ui.send("state", state)
  }

  // ---- glasses rendering -------------------------------------------------
  let shownKey: string | null = null
  let pendingScene: Scene | null = null
  let lastRenderAt = 0
  let renderTimer: ReturnType<typeof setTimeout> | null = null

  function canvas() {
    const d = session.capabilities?.display
    stats.display = d ? {width: d.width, height: d.height} : null
    // 500x220 is the size Mentra says renders on every positioning device.
    return {w: d?.width ?? 500, h: d?.height ?? 220}
  }

  /** Pixel rows used by the top and bottom sections, given what is in the scene. */
  function layout(hasTitle: boolean, hasSource: boolean, hasTime: boolean, hasBar: boolean) {
    const {w, h} = canvas()
    const top = (hasTitle ? ROW_H : 0) + (hasSource ? ROW_H : 0)
    const bottomH = (hasTime ? ROW_H : 0) + (hasBar ? BAR_H + BAR_GAP : 0)
    return {w, h, top, captionsH: Math.max(0, h - top - bottomH)}
  }

  function buildElements(scene: Scene): RenderElement[] {
    const hasBar = !!scene.time && scene.progress !== null
    const {w, h, top, captionsH} = layout(!!scene.title, !!scene.source, !!scene.time, hasBar)
    const els: RenderElement[] = []
    const line = (id: string, y: number, text: string): RenderElement => ({
      type: "text",
      id,
      box: {x: 0, y, w, h: ROW_H},
      text,
      style: {breakMode: "word", overflow: "ellipsis"},
    })

    let y = 0
    if (scene.title) {
      els.push(line("title", y, scene.title))
      y += ROW_H
    }
    if (scene.source) els.push(line("source", y, scene.source))

    if (scene.captions && captionsH > 0) {
      els.push({
        type: "text",
        id: "captions",
        box: {x: 0, y: top, w, h: captionsH},
        text: scene.captions,
        style: {breakMode: "word", overflow: "clip"},
      })
    }

    if (scene.time) {
      let by = h - ROW_H
      if (hasBar) {
        const barY = by - BAR_GAP - BAR_H
        const barW = w - 4
        els.push({type: "rect", id: "bar", box: {x: 2, y: barY, w: barW, h: BAR_H}, style: {border: 1, radius: 3}})
        const fillW = Math.round(barW * (scene.progress ?? 0))
        if (fillW >= BAR_H) {
          // No fill option on rects, so a border half the bar height fills it in.
          els.push({
            type: "rect",
            id: "barfill",
            box: {x: 2, y: barY, w: fillW, h: BAR_H},
            style: {border: Math.ceil(BAR_H / 2), radius: 3},
          })
        }
      }
      els.push(line("time", by, scene.time))
    }
    return els
  }

  function previewText(scene: Scene): string {
    const parts = [scene.title, scene.source, scene.captions].filter(Boolean)
    if (scene.time) {
      if (scene.progress !== null) parts.push(previewBar(scene.progress))
      parts.push(scene.time)
    }
    return parts.join("\n")
  }

  function drawNow(scene: Scene) {
    renderTimer = null
    pendingScene = null
    const key = JSON.stringify(scene)
    if (key === shownKey) return
    shownKey = key
    lastRenderAt = Date.now()
    stats.renders++
    stats.preview = previewText(scene)
    const els = buildElements(scene)
    const p = session.display.render(els)
    p.then((r) => {
      stats.lastRenderStatus = r.reason ? `${r.status} (${r.reason})` : r.status
      stats.lastRenderDegraded = !!r.degraded
    })
  }

  /** Draws `scene`, but no more often than settings.minRenderMs. The newest scene always wins. */
  function show(scene: Scene) {
    if (JSON.stringify(scene) === shownKey && pendingScene === null) return
    const wait = settings.minRenderMs - (Date.now() - lastRenderAt)
    if (wait <= 0) {
      if (renderTimer) clearTimeout(renderTimer)
      drawNow(scene)
      return
    }
    pendingScene = scene
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        if (pendingScene !== null) drawNow(pendingScene)
        else renderTimer = null
      }, wait)
    }
  }

  function clearGlasses() {
    if (renderTimer) clearTimeout(renderTimer)
    renderTimer = null
    pendingScene = null
    drawNow(EMPTY_SCENE)
  }

  // ---- caption state -----------------------------------------------------
  let lastCaption: BridgeCaption | null = null
  /** When the caption text last changed (new line or new partial words). */
  let lastChangeAt = Date.now()
  /** Lines up to this id were cleared after a quiet stretch and stay hidden. */
  let hiddenUpToId = -1
  /** The in-progress words at the moment of clearing, also kept hidden. */
  let hiddenPartial = ""

  function maxLineId(c: BridgeCaption | null): number {
    let id = -1
    for (const l of c?.lines ?? []) if (typeof l?.id === "number" && l.id > id) id = l.id
    return id
  }

  /** True once nothing new has come in for settings.clearAfterSec (0 = never clear). */
  function isIdle(): boolean {
    return settings.clearAfterSec > 0 && Date.now() - lastChangeAt >= settings.clearAfterSec * 1000
  }

  function statusFrom(c: BridgeCaption): BridgeStatus {
    const s = c.status
    if (s === "starting" || s === "ok" || s === "silent" || s === "stopped") return s
    return c.running ? "ok" : "stopped"
  }

  /** The captions section: status messages, or the newest caption rows. */
  function composeCaptions(maxRows: number, mediaShowing: boolean): string {
    switch (stats.status) {
      case "paused":
        return ""
      case "connecting":
        return "Captions: connecting to Media Bridge..."
      case "unreachable":
        return "Media Bridge not reachable.\nOpen Media Bridge and turn on Captions."
      case "stopped":
        return "Captions are off.\nTurn them on in Media Bridge."
      case "starting":
        return "Captions: starting..."
      case "silent":
      case "ok": {
        // Quiet for a while (audio paused, or a long gap): clear the captions and
        // keep the old text hidden, so only new speech shows when audio resumes.
        if (isIdle()) {
          hiddenUpToId = Math.max(hiddenUpToId, maxLineId(lastCaption))
          hiddenPartial = (lastCaption?.partial ?? "").trim()
          return ""
        }
        const partial = (lastCaption?.partial ?? "").trim()
        const rows = lastCaption
          ? buildRows(
              {
                ...lastCaption,
                // Drop old in-progress words if they're still the same as when we cleared.
                partial: partial && partial !== hiddenPartial ? partial : "",
              },
              {
                live: settings.mode === "live",
                maxRows,
                charsPerRow: settings.charsPerRow,
                afterId: hiddenUpToId,
              },
            )
          : []
        if (rows.length) return rows.join("\n")
        // Nothing new since a clear, or the track info already fills the screen: stay blank.
        return hiddenUpToId >= 0 || hiddenPartial || mediaShowing ? "" : "Listening..."
      }
    }
  }

  // ---- media state -------------------------------------------------------
  const clock = new MediaClock()
  /** When playback last stopped being "playing", or 0 while playing. */
  let notPlayingSince = 0

  /** True while the title and time bar should be on screen. */
  function mediaVisible(m: BridgeMedia | null, now: number): m is BridgeMedia {
    if (!hasTrack(m)) return false
    if (m.state === "playing" || m.state === "buffering") return true
    return notPlayingSince > 0 && now - notPlayingSince < PAUSED_INFO_MS
  }

  // ---- putting the screen together ---------------------------------------
  function composeScene(): Scene {
    if (!settings.enabled) return EMPTY_SCENE
    const now = Date.now()
    const m = clock.media
    const showMedia = mediaWanted() && mediaVisible(m, now)

    let title = ""
    let source = ""
    let time = ""
    let progress: number | null = null
    if (showMedia && m) {
      if (settings.showTrackInfo) {
        title = truncate(m.title || m.album || "", settings.charsPerRow)
        source = truncate(sourceLine(m), settings.charsPerRow)
      }
      if (settings.showTimeBar) {
        const bar = buildTimeBar(m, clock.positionMs(now))
        time = bar.text
        progress = bar.progress
      }
    }

    const {captionsH} = layout(!!title, !!source, !!time, !!time && progress !== null)
    const maxRows = Math.max(1, Math.min(settings.rows, Math.floor(captionsH / ROW_H)))
    const captions = composeCaptions(maxRows, !!(title || source || time))
    return {title, source, captions, time, progress}
  }

  function refresh() {
    if (settings.enabled) show(composeScene())
  }

  // ---- caption polling ---------------------------------------------------
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let polling = false
  let loggedStatus: BridgeStatus | null = null

  async function pollOnce() {
    stats.polls++
    const started = Date.now()
    try {
      const c = (await fetchJson(settings.bridgeUrl)) as BridgeCaption
      stats.lastFetchMs = Date.now() - started
      stats.lastError = null
      stats.silentForSec = typeof c.silentForSec === "number" ? c.silentForSec : 0
      stats.engine = typeof c.engine === "string" ? c.engine : ""
      const seq = typeof c.seq === "number" ? c.seq : -1
      // seq bumps on every caption change; -1 means an old bridge without it,
      // so fall back to comparing the text.
      const changed =
        seq === -1
          ? JSON.stringify([c.lines, c.partial]) !==
            JSON.stringify([lastCaption?.lines, lastCaption?.partial])
          : seq !== stats.seq
      if (changed) lastChangeAt = Date.now()
      stats.seq = seq
      stats.status = statusFrom(c)
      lastCaption = c
      // Even with no change we still recompose below, so the idle clear can fire.
    } catch (e) {
      stats.failures++
      stats.lastError = e instanceof Error ? e.message : String(e)
      stats.status = "unreachable"
      stats.seq = -1
      lastCaption = null
    }
    if (stats.status !== loggedStatus) {
      loggedStatus = stats.status
      console.log(
        `bridge status: ${stats.status}` +
          (stats.lastError ? ` (error: ${stats.lastError})` : "") +
          (stats.lastFetchMs != null && !stats.lastError ? ` (${stats.lastFetchMs} ms)` : ""),
      )
    }
    refresh()
  }

  async function loop() {
    if (!polling) return
    await pollOnce()
    if (polling) pollTimer = setTimeout(loop, settings.pollMs)
  }

  // ---- media polling -----------------------------------------------------
  let mediaTimer: ReturnType<typeof setTimeout> | null = null

  async function pollMediaOnce() {
    if (!mediaWanted()) {
      stats.mediaStatus = "unused"
      stats.mediaError = null
      clock.update(null, Date.now())
      return
    }
    try {
      const m = (await fetchJson(settings.mediaUrl)) as BridgeMedia
      stats.mediaError = null
      stats.mediaStatus = m.enabled === false ? "off" : hasTrack(m) ? "ok" : "none"
      const now = Date.now()
      clock.update(m, now)
      if (m.state === "playing") notPlayingSince = 0
      else if (!notPlayingSince) notPlayingSince = now
    } catch (e) {
      stats.mediaStatus = "unreachable"
      stats.mediaError = e instanceof Error ? e.message : String(e)
      clock.update(null, Date.now())
    }
  }

  async function mediaLoop() {
    if (!polling) return
    await pollMediaOnce()
    // Redraw every tick too, so the clock counts up while playing.
    refresh()
    if (polling) mediaTimer = setTimeout(mediaLoop, MEDIA_POLL_MS)
  }

  // ---- start / stop ------------------------------------------------------
  function startPolling() {
    if (polling) return
    polling = true
    stats.status = "connecting"
    stats.seq = -1
    lastChangeAt = Date.now()
    refresh()
    void loop()
    void mediaLoop()
  }

  function stopPolling() {
    polling = false
    if (pollTimer) clearTimeout(pollTimer)
    if (mediaTimer) clearTimeout(mediaTimer)
    pollTimer = null
    mediaTimer = null
    stats.status = "paused"
    lastCaption = null
    clearGlasses()
  }

  function applyEnabled() {
    if (settings.enabled) startPolling()
    else stopPolling()
  }

  // ---- inputs ------------------------------------------------------------
  // A short press on the glasses pauses or resumes captions.
  session.input.onButtonPress((b) => {
    if (b.pressType !== "short") return
    settings.enabled = !settings.enabled
    void saveSettings()
    applyEnabled()
    pushState()
  })

  // ---- phone settings screen ---------------------------------------------
  function applySettings(next: Settings) {
    const wasEnabled = settings.enabled
    settings = next
    void saveSettings()
    if (settings.enabled !== wasEnabled) applyEnabled()
    else refresh() // re-layout with the new settings right away
    pushState()
  }

  ui.onOpen(() => pushState())
  ui.on("getState", () => pushState())
  ui.on("setSettings", (patch) => applySettings(clampSettings({...settings, ...patch})))
  ui.on("resetSettings", () => applySettings({...DEFAULT_SETTINGS}))

  // Keep the phone screen's numbers fresh while it is open.
  setInterval(pushState, 1000)

  console.log(`Media Bridge Captions started: ${settings.bridgeUrl}, mode=${settings.mode}`)
  applyEnabled()
})
