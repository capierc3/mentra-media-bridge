/**
 * Shared types and the typed message bus between the background (glasses
 * logic) and the UI (phone settings screen).
 */

/** "live" shows words still being recognized; "lines" shows finished lines only. */
export type CaptionMode = "live" | "lines"

/**
 * Where captions come from:
 * - "phone": the Media Bridge Android app on this phone (127.0.0.1).
 *   Also used for a PC connected over USB with `adb reverse`.
 * - "pc": the PC Caption Bridge (Windows Live Captions) at `pcHost` on the local network.
 */
export type CaptionSource = "phone" | "pc"

export const CAPTION_PORT = 8767
export const MEDIA_PORT = 8766

export interface Settings {
  /** Master switch. When false the app stops checking the bridge and clears the glasses. */
  enabled: boolean
  mode: CaptionMode
  /** How often to ask the bridge for new text, in ms. */
  pollMs: number
  /** Minimum gap between glasses redraws, in ms. */
  minRenderMs: number
  /** How many caption rows to show on the glasses. */
  rows: number
  /** Rough characters per glasses row, used for our own word wrapping. */
  charsPerRow: number
  /** Clear the glasses after this many seconds with no new caption text (0 = never). */
  clearAfterSec: number
  /** Show the track title and source (artist · app) at the top. */
  showTrackInfo: boolean
  /** Show elapsed / total / remaining time and a progress bar at the bottom. */
  showTimeBar: boolean
  source: CaptionSource
  /** The PC's address on the local network, e.g. "192.168.1.20". Used when source is "pc". */
  pcHost: string
  /** Phone bridge caption endpoint. */
  bridgeUrl: string
  /** Phone bridge now-playing endpoint. */
  mediaUrl: string
}

/** Cleans up what was typed into the PC address box: drops http://, paths and a port. */
export function cleanHost(raw: string): string {
  return raw
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
}

/** The caption URL actually polled for these settings. */
export function captionUrl(s: Settings): string {
  return s.source === "pc" ? `http://${cleanHost(s.pcHost)}:${CAPTION_PORT}/caption` : s.bridgeUrl
}

/** The now-playing URL actually polled for these settings. */
export function nowPlayingUrl(s: Settings): string {
  return s.source === "pc" ? `http://${cleanHost(s.pcHost)}:${MEDIA_PORT}/media` : s.mediaUrl
}

/** What to call the caption source in messages. */
export function sourceName(s: Settings): string {
  return s.source === "pc" ? "the PC" : "Media Bridge"
}

/** What the bridge's media feed (port 8766) is telling us. */
export type MediaStatus =
  | "unused" // track info and time bar both turned off
  | "unreachable"
  | "off" // the Media switch is off in the bridge app
  | "none" // nothing is playing
  | "ok"

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  mode: "live",
  pollMs: 500,
  minRenderMs: 400,
  rows: 4,
  charsPerRow: 38,
  clearAfterSec: 8,
  showTrackInfo: true,
  showTimeBar: true,
  source: "phone",
  pcHost: "",
  bridgeUrl: "http://127.0.0.1:8767/caption",
  mediaUrl: "http://127.0.0.1:8766/media",
}

/** Where things stand with the bridge, as shown on the phone screen. */
export type BridgeStatus =
  | "paused" // turned off in this app
  | "connecting" // no answer yet
  | "unreachable" // fetch failed (bridge not running, or blocked)
  | "stopped" // bridge is up but captions are off there
  | "sourcePaused" // paused on the PC (tray menu: Pause captions)
  | "starting" // bridge is loading the speech model
  | "silent" // running, nothing heard lately
  | "ok"

export interface Stats {
  status: BridgeStatus
  lastError: string | null
  polls: number
  failures: number
  /** Round-trip time of the last successful check, in ms. */
  lastFetchMs: number | null
  /** The bridge's change counter from the last response. */
  seq: number
  renders: number
  lastRenderStatus: string | null
  lastRenderDegraded: boolean
  silentForSec: number
  engine: string
  display: {width?: number; height?: number} | null
  /** Exactly what is on the glasses right now. */
  preview: string
  mediaStatus: MediaStatus
  mediaError: string | null
}

export interface State {
  settings: Settings
  stats: Stats
}

export interface Channels {
  // UI → background
  "getState": Record<string, never>
  "setSettings": Partial<Settings>
  "resetSettings": Record<string, never>

  // background → UI
  "state": State
}

declare global {
  // eslint-disable-next-line no-var
  var mentra: import("@mentra/miniapp/ui").MentraTyped<Channels>
}
