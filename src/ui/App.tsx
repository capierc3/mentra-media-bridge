import {useEffect, useState, type JSX} from "react"
import {captionUrl, type BridgeStatus, type MediaStatus, type Settings, type State} from "../shared/channels"

const MEDIA_TEXT: Record<MediaStatus, string> = {
  unused: "Not used",
  unreachable: "Can't reach the media feed",
  off: "Media is off in Media Bridge",
  none: "Nothing playing",
  ok: "OK",
}

function Toggle(props: {label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void}) {
  return (
    <label className="toggle">
      <span>
        <span className="toggle-label">{props.label}</span>
        {props.hint ? <span className="hint">{props.hint}</span> : null}
      </span>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  )
}

const STATUS_TEXT: Record<BridgeStatus, string> = {
  paused: "Paused in this app",
  connecting: "Connecting to Media Bridge…",
  unreachable: "Can't reach Media Bridge",
  stopped: "Media Bridge is running, but captions are off there",
  sourcePaused: "Paused on the PC (tray icon → Resume captions)",
  starting: "Media Bridge is starting captions…",
  silent: "Listening (nothing heard lately)",
  ok: "Captioning",
}

const PC_STATUS_TEXT: Partial<Record<BridgeStatus, string>> = {
  connecting: "Connecting to the PC…",
  unreachable: "Can't reach the PC",
  stopped: "PC Caption Bridge is running, but Live Captions is closed (Win+Ctrl+L)",
}

function statusText(status: BridgeStatus, s: Settings): string {
  return (s.source === "pc" ? PC_STATUS_TEXT[status] : undefined) ?? STATUS_TEXT[status]
}

const GOOD: BridgeStatus[] = ["ok", "silent"]

function NumberField(props: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="field">
      <span className="field-label">
        {props.label}
        <span className="field-value">
          {props.value}
          {props.unit ?? ""}
        </span>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      {props.hint ? <span className="hint">{props.hint}</span> : null}
    </label>
  )
}

export function App(): JSX.Element {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    const unsub = mentra.on("state", setState)
    mentra.send("getState", {})
    return unsub
  }, [])

  const set = (patch: Partial<Settings>) => mentra.send("setSettings", patch)

  if (!state) {
    return (
      <div className="app">
        <p className="muted">Loading…</p>
      </div>
    )
  }

  const {settings: s, stats} = state
  const good = GOOD.includes(stats.status)

  return (
    <div className="app">
      <h1>Media Bridge Captions</h1>

      <section className="card">
        <div className="row">
          <span className={`dot ${good ? "good" : stats.status === "paused" ? "" : "bad"}`} />
          <strong>{statusText(stats.status, s)}</strong>
        </div>
        {stats.lastError ? <p className="error">Last error: {stats.lastError}</p> : null}
        {stats.status === "unreachable" && s.source === "pc" ? (
          <p className="hint">
            Make sure PC Caption Bridge is running on the PC, the address below matches one it prints,
            and the phone is on the same Wi-Fi. Windows Firewall must allow it (it asks the first time).
          </p>
        ) : null}
        {stats.status === "unreachable" && s.source === "phone" ? (
          <p className="hint">
            Make sure the Media Bridge app is installed and its Captions switch is on. If it is on and
            this still fails, the Mentra app may be blocking local http requests. Note the error above.
          </p>
        ) : null}
        <pre className="preview">{stats.preview || " "}</pre>
        <button
          type="button"
          className={s.enabled ? "secondary" : ""}
          onClick={() => set({enabled: !s.enabled})}
        >
          {s.enabled ? "Pause captions" : "Resume captions"}
        </button>
        <p className="hint">You can also short-press the glasses button to pause or resume.</p>
      </section>

      <section className="card">
        <h2>Source</h2>
        <div className="segmented">
          <button
            type="button"
            className={s.source === "phone" ? "active" : ""}
            onClick={() => set({source: "phone"})}
          >
            Phone
          </button>
          <button
            type="button"
            className={s.source === "pc" ? "active" : ""}
            onClick={() => set({source: "pc"})}
          >
            PC
          </button>
        </div>
        {s.source === "pc" ? (
          <>
            <label className="field">
              <span className="field-label">PC address</span>
              <input
                key="pcHost"
                type="text"
                inputMode="decimal"
                placeholder="e.g. 192.168.1.20"
                defaultValue={s.pcHost}
                onBlur={(e) => set({pcHost: e.target.value})}
              />
            </label>
            <p className="hint">
              Captions from Windows Live Captions, through PC Caption Bridge running on the PC. Use one of
              the addresses it prints. Phone and PC must be on the same Wi-Fi.
            </p>
          </>
        ) : (
          <p className="hint">
            Captions from the Media Bridge app on this phone. Also use this for a PC plugged in over USB
            with adb reverse.
          </p>
        )}
        <p className="hint">Checking {captionUrl(s)}</p>
      </section>

      <section className="card">
        <h2>Mode</h2>
        <div className="segmented">
          <button
            type="button"
            className={s.mode === "live" ? "active" : ""}
            onClick={() => set({mode: "live"})}
          >
            Live
          </button>
          <button
            type="button"
            className={s.mode === "lines" ? "active" : ""}
            onClick={() => set({mode: "lines"})}
          >
            Finished lines
          </button>
        </div>
        <p className="hint">
          {s.mode === "live"
            ? "Shows words while they are still being recognized. Least lag, but the last few words can change."
            : "Shows only finished lines. Steadier text, but a few seconds behind."}
        </p>
      </section>

      <section className="card">
        <h2>Show on glasses</h2>
        <Toggle
          label="Track & source"
          hint="Title on top, then artist and app."
          checked={s.showTrackInfo}
          onChange={(v) => set({showTrackInfo: v})}
        />
        <Toggle
          label="Time bar"
          hint="Elapsed / total, time left, and a progress bar at the bottom."
          checked={s.showTimeBar}
          onChange={(v) => set({showTimeBar: v})}
        />
        {s.source === "phone" &&
        (s.showTrackInfo || s.showTimeBar) &&
        (stats.mediaStatus === "off" || stats.mediaStatus === "unreachable") ? (
          <p className="error">
            {MEDIA_TEXT[stats.mediaStatus]}. Turn on "Enable media bridge" in the Media Bridge app (it needs
            notification access).
          </p>
        ) : null}
        <p className="hint">
          These use rows the captions would otherwise get. They stay up for 30 s after you pause, then clear.
        </p>
      </section>

      <section className="card">
        <h2>Layout</h2>
        <NumberField
          label="Rows on glasses"
          value={s.rows}
          min={1}
          max={8}
          step={1}
          onChange={(v) => set({rows: v})}
        />
        <NumberField
          label="Characters per row"
          hint="Lower this if the newest words get cut off at the bottom."
          value={s.charsPerRow}
          min={15}
          max={70}
          step={1}
          onChange={(v) => set({charsPerRow: v})}
        />
        <NumberField
          label="Clear after silence"
          hint={
            s.clearAfterSec === 0
              ? "Never: the last lines stay on the glasses."
              : "Blanks the glasses when no new words arrive for this long, like when audio is paused."
          }
          value={s.clearAfterSec}
          min={0}
          max={60}
          step={1}
          unit={s.clearAfterSec === 0 ? " (off)" : " s"}
          onChange={(v) => set({clearAfterSec: v})}
        />
      </section>

      <section className="card">
        <h2>Speed</h2>
        <NumberField
          label="Check bridge every"
          value={s.pollMs}
          min={100}
          max={2000}
          step={50}
          unit=" ms"
          onChange={(v) => set({pollMs: v})}
        />
        <NumberField
          label="Redraw glasses at most every"
          hint="The Even app uses 1000 ms in live mode. Lower is snappier if Bluetooth keeps up."
          value={s.minRenderMs}
          min={0}
          max={2000}
          step={50}
          unit=" ms"
          onChange={(v) => set({minRenderMs: v})}
        />
      </section>

      <section className="card">
        <h2>Diagnostics</h2>
        <dl className="stats">
          <dt>Checks</dt>
          <dd>
            {stats.polls} ({stats.failures} failed)
          </dd>
          <dt>Last check took</dt>
          <dd>{stats.lastFetchMs == null ? "—" : `${stats.lastFetchMs} ms`}</dd>
          <dt>Bridge change #</dt>
          <dd>{stats.seq}</dd>
          <dt>Glasses redraws</dt>
          <dd>{stats.renders}</dd>
          <dt>Last redraw</dt>
          <dd>
            {stats.lastRenderStatus ?? "—"}
            {stats.lastRenderDegraded ? " (adjusted by host)" : ""}
          </dd>
          <dt>Display</dt>
          <dd>
            {stats.display?.width && stats.display?.height
              ? `${stats.display.width} × ${stats.display.height}`
              : "unknown"}
          </dd>
          <dt>Engine</dt>
          <dd>{stats.engine || "—"}</dd>
          <dt>Media feed</dt>
          <dd>
            {MEDIA_TEXT[stats.mediaStatus]}
            {stats.mediaError ? ` (${stats.mediaError})` : ""}
          </dd>
        </dl>
        <label className="field">
          <span className="field-label">Phone bridge address</span>
          <input
            type="text"
            defaultValue={s.bridgeUrl}
            onBlur={(e) => set({bridgeUrl: e.target.value})}
          />
        </label>
        <button type="button" className="secondary" onClick={() => mentra.send("resetSettings", {})}>
          Reset settings
        </button>
      </section>
    </div>
  )
}
