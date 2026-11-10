import {useEffect, useState, type JSX} from "react"
import type {BridgeStatus, Settings, State} from "../shared/channels"

const STATUS_TEXT: Record<BridgeStatus, string> = {
  paused: "Paused in this app",
  connecting: "Connecting to Media Bridge…",
  unreachable: "Can't reach Media Bridge",
  stopped: "Media Bridge is running, but captions are off there",
  starting: "Media Bridge is starting captions…",
  silent: "Listening (nothing heard lately)",
  ok: "Captioning",
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
          <strong>{STATUS_TEXT[stats.status]}</strong>
        </div>
        {stats.lastError ? <p className="error">Last error: {stats.lastError}</p> : null}
        {stats.status === "unreachable" ? (
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
        </dl>
        <label className="field">
          <span className="field-label">Bridge address</span>
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
