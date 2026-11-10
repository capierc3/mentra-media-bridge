/**
 * Background (glasses) side of Media Bridge Captions.
 *
 * Checks the TakeMotions Media Bridge Android app at
 * http://127.0.0.1:8767/caption on a timer, turns its caption feed into a few
 * rows of text, and draws them on the glasses. Runs whenever the Mentra app is
 * alive, whether or not the phone settings screen is open.
 */

import {registerMiniapp, type UIModule} from "@mentra/miniapp/background"
import {
  DEFAULT_SETTINGS,
  type BridgeStatus,
  type Channels,
  type Settings,
  type State,
  type Stats,
} from "../shared/channels"
import {buildRows, type BridgeCaption} from "./captions"

const SETTINGS_KEY = "settings"
const FETCH_TIMEOUT_MS = 2000

/** Keeps numbers from the settings screen within sane bounds. */
function clampSettings(s: Settings): Settings {
  const clamp = (v: number, lo: number, hi: number, d: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d
  return {
    enabled: s.enabled !== false,
    mode: s.mode === "lines" ? "lines" : "live",
    pollMs: clamp(s.pollMs, 100, 5000, DEFAULT_SETTINGS.pollMs),
    minRenderMs: clamp(s.minRenderMs, 0, 5000, DEFAULT_SETTINGS.minRenderMs),
    rows: clamp(s.rows, 1, 8, DEFAULT_SETTINGS.rows),
    charsPerRow: clamp(s.charsPerRow, 10, 80, DEFAULT_SETTINGS.charsPerRow),
    clearAfterSec: clamp(s.clearAfterSec, 0, 120, DEFAULT_SETTINGS.clearAfterSec),
    bridgeUrl:
      typeof s.bridgeUrl === "string" && s.bridgeUrl.trim()
        ? s.bridgeUrl.trim()
        : DEFAULT_SETTINGS.bridgeUrl,
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
  }

  function pushState() {
    if (!ui.isOpen()) return
    const state: State = {settings: {...settings}, stats: {...stats}}
    ui.send("state", state)
  }

  // ---- glasses rendering -------------------------------------------------
  let shownText: string | null = null
  let pendingText: string | null = null
  let lastRenderAt = 0
  let renderTimer: ReturnType<typeof setTimeout> | null = null

  function canvas() {
    const d = session.capabilities?.display
    stats.display = d ? {width: d.width, height: d.height} : null
    // 500x220 is the size Mentra says renders on every positioning device.
    return {w: d?.width ?? 500, h: d?.height ?? 220}
  }

  function drawNow(text: string) {
    renderTimer = null
    pendingText = null
    if (text === shownText) return
    shownText = text
    lastRenderAt = Date.now()
    stats.renders++
    stats.preview = text
    const {w, h} = canvas()
    const p =
      text === ""
        ? session.display.render([])
        : session.display.render([
            {
              type: "text",
              id: "captions",
              box: {x: 0, y: 0, w, h},
              text,
              style: {breakMode: "word", overflow: "clip"},
            },
          ])
    p.then((r) => {
      stats.lastRenderStatus = r.reason ? `${r.status} (${r.reason})` : r.status
      stats.lastRenderDegraded = !!r.degraded
    })
  }

  /** Draws `text`, but no more often than settings.minRenderMs. The newest text always wins. */
  function show(text: string) {
    if (text === shownText && pendingText === null) return
    const wait = settings.minRenderMs - (Date.now() - lastRenderAt)
    if (wait <= 0) {
      if (renderTimer) clearTimeout(renderTimer)
      drawNow(text)
      return
    }
    pendingText = text
    if (!renderTimer) {
      renderTimer = setTimeout(() => {
        if (pendingText !== null) drawNow(pendingText)
        else renderTimer = null
      }, wait)
    }
  }

  function clearGlasses() {
    if (renderTimer) clearTimeout(renderTimer)
    renderTimer = null
    pendingText = null
    drawNow("")
  }

  // ---- bridge polling ----------------------------------------------------
  let lastCaption: BridgeCaption | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let polling = false
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

  /** Works out what the glasses should say for the current status and caption. */
  function composeText(): string {
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
        // Quiet for a while (audio paused, or a long gap): clear the glasses and
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
                maxRows: settings.rows,
                charsPerRow: settings.charsPerRow,
                afterId: hiddenUpToId,
              },
            )
          : []
        if (rows.length) return rows.join("\n")
        // Nothing new since a clear: stay blank instead of nagging.
        return hiddenUpToId >= 0 || hiddenPartial ? "" : "Listening..."
      }
    }
  }

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
      const status = statusFrom(c)
      // seq bumps on every caption change; -1 means an old bridge without it,
      // so fall back to comparing the text.
      const changed =
        seq === -1
          ? JSON.stringify([c.lines, c.partial]) !==
            JSON.stringify([lastCaption?.lines, lastCaption?.partial])
          : seq !== stats.seq
      if (changed) lastChangeAt = Date.now()
      stats.seq = seq
      stats.status = status
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
    if (settings.enabled) show(composeText())
  }
  let loggedStatus: BridgeStatus | null = null

  async function loop() {
    if (!polling) return
    await pollOnce()
    if (polling) pollTimer = setTimeout(loop, settings.pollMs)
  }

  function startPolling() {
    if (polling) return
    polling = true
    stats.status = "connecting"
    stats.seq = -1
    lastChangeAt = Date.now()
    show(composeText())
    void loop()
  }

  function stopPolling() {
    polling = false
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
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
  ui.onOpen(() => pushState())
  ui.on("getState", () => pushState())
  ui.on("setSettings", (patch) => {
    const wasEnabled = settings.enabled
    settings = clampSettings({...settings, ...patch})
    void saveSettings()
    if (settings.enabled !== wasEnabled) applyEnabled()
    else if (settings.enabled) show(composeText()) // re-wrap with new rows/width/mode now
    pushState()
  })
  ui.on("resetSettings", () => {
    const wasEnabled = settings.enabled
    settings = {...DEFAULT_SETTINGS}
    void saveSettings()
    if (settings.enabled !== wasEnabled) applyEnabled()
    else show(composeText())
    pushState()
  })

  // Keep the phone screen's numbers fresh while it is open.
  setInterval(pushState, 1000)

  console.log(`Media Bridge Captions started: ${settings.bridgeUrl}, mode=${settings.mode}`)
  applyEnabled()
})
