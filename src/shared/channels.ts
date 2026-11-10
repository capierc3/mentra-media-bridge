/**
 * Shared types and the typed message bus between the background (glasses
 * logic) and the UI (phone settings screen).
 */

/** "live" shows words still being recognized; "lines" shows finished lines only. */
export type CaptionMode = "live" | "lines"

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
  /** Bridge caption endpoint. */
  bridgeUrl: string
  /** Bridge now-playing endpoint. */
  mediaUrl: string
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
  bridgeUrl: "http://127.0.0.1:8767/caption",
  mediaUrl: "http://127.0.0.1:8766/media",
}

/** Where things stand with the bridge, as shown on the phone screen. */
export type BridgeStatus =
  | "paused" // turned off in this app
  | "connecting" // no answer yet
  | "unreachable" // fetch failed (bridge not running, or blocked)
  | "stopped" // bridge is up but captions are off there
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
