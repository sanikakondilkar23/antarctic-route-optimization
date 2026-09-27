import React from 'react'

/**
 * Full-width forecast timeline.
 *
 * Drives the real SIC timestep: the chart, the date and every SIC metric
 * follow the slider. It sits in its own fixed band at the bottom of the
 * dashboard, so scrubbing or playing can never push the map around and the
 * page itself never scrolls.
 */
export default function Timeline({
  metadata, timestep, onChange, playing, onPlayToggle,
  originStep, targetStep, rerouteTimestep, onJump, busy,
  speed, setSpeed,
}) {
  const n = metadata?.n_timesteps ?? 167
  const dates = metadata?.dates ?? []
  const last = n - 1
  const date = dates[timestep] ?? '—'
  const pct = last > 0 ? (timestep / last) * 100 : 0

  // evenly spaced scale ticks: D0 … D41 … D83 … D125 … D166 for n = 167
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    Math.min(last, Math.round(f * last)))
  const uniqTicks = [...new Set(ticks)]

  return (
    <section className="timeline">
      <div className="tl-left">
        <span className="tl-title">Forecast Timeline</span>
        <span className="tl-span">
          {metadata ? `${metadata.date_range[0]} \u2192 ${metadata.date_range[1]}` : '\u2014'}
        </span>
        <div className="tl-events">
          <button
            type="button"
            className={`tl-evt route ${timestep === originStep ? 'active' : ''}`}
            onClick={() => onJump(originStep)}
          >
            ▣ route · D{originStep}
          </button>
          {rerouteTimestep != null ? (
            <button
              type="button"
              className={`tl-evt rr ${timestep === rerouteTimestep ? 'active' : ''}`}
              onClick={() => onJump(rerouteTimestep)}
            >
              ↻ rerouted · D{rerouteTimestep}
            </button>
          ) : (
            <span className="tl-evt rr dim">↻ target · D{targetStep}</span>
          )}
        </div>
      </div>

      <div className="tl-mid">
        <div className="tl-track">
          <span className="tl-cap">D0</span>
          <div className="tl-rail">
            <input
              type="range"
              className="tl-range"
              style={{ '--pct': `${pct}%` }}
              min={0}
              max={last}
              value={timestep}
              onChange={(e) => onChange(Number(e.target.value))}
              aria-label="forecast timestep"
            />
            {/* one mark per real forecast timestep: D0 … D166 */}
            <div className="tl-ruler" aria-hidden="true">
              {Array.from({ length: n }, (_, d) => (
                <i
                  key={d}
                  className={`rk ${d === timestep ? 'on' : ''} ${
                    d === originStep ? 'mk-o' : d === rerouteTimestep ? 'mk-r' : ''
                  }`}
                />
              ))}
            </div>
          </div>
          <span className="tl-cap">D{last}</span>
        </div>

        <div className="tl-scale">
          {uniqTicks.map((d) => (
            <button
              type="button"
              key={d}
              className={`tl-tick ${timestep === d ? 'on' : ''}`}
              onClick={() => onChange(d)}
            >
              D{d}
            </button>
          ))}
          <span className="tl-hint">
            {n} real SIC timesteps · this step&apos;s raster drives the chart
          </span>
        </div>
      </div>

      <div className="tl-right">
        <div className="tl-readout">
          <span className="tl-day">D<b>{timestep}</b></span>
          <span className="tl-date">{date}</span>
        </div>
        <div className="tl-ctl">
          <button
            type="button"
            className="btn btn-primary tl-play"
            onClick={onPlayToggle}
            disabled={busy.slice && !playing}
            title={busy.slice && !playing ? 'Reading the real SIC raster\u2026' : undefined}
          >
            {playing ? '\u275a\u275a Pause' : '\u25b6 Play forecast'}
          </button>
          <div className="tl-speed">
            {[300, 160, 70].map((ms) => (
              <button
                key={ms}
                type="button"
                className={`sp ${speed === ms ? 'on' : ''}`}
                onClick={() => setSpeed(ms)}
              >
                {ms === 300 ? '1×' : ms === 160 ? '2×' : '4×'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
