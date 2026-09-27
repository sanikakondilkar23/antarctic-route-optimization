import React from 'react'
import MiniField from './MiniField.jsx'
import { count } from './ui.jsx'

/**
 * ENVIRONMENT CHANGE VIEW
 *
 * BEFORE = real SIC at the origin forecast step
 * AFTER  = real SIC at the reroute forecast step
 * DIFFERENCE = arithmetic difference of those two real arrays
 *
 * The two frames come from GET /api/sic/<t> (the committed
 * routing_sic_2026.npy). Nothing about the change is invented; if the fields
 * are nearly identical, that is what the panel shows and says.
 */
export default function EnvCompare({
  before, after, diff, lat, lon, routeBefore, routeAfter,
  beforeLabel, afterLabel, comparison, loading, onViewDiff,
}) {
  const sB = before?.stats
  const sA = after?.stats

  return (
    <section className="card card-envc">
      <header className="card-head">
        <span className="ic">&#8644;</span>
        <h3>Environment Change</h3>
        {comparison ? (
          <span className={`card-badge ${comparison.changed_cells ? 'busy' : 'ok'}`}>
            {comparison.changed_cells} route cells changed
          </span>
        ) : (
          <span className="card-badge">awaiting reroute</span>
        )}
      </header>
      <div className="card-body">
        <div className="triptych">
          <MiniField
            slice={before} lat={lat} lon={lon} mode="sic"
            route={routeBefore} label="BEFORE" sub={beforeLabel} tone="before"
          />
          <MiniField
            slice={after} lat={lat} lon={lon} mode="sic"
            route={routeAfter} label="AFTER" sub={afterLabel} tone="after"
          />
          <MiniField
            slice={after || before} lat={lat} lon={lon} mode="diff" diff={diff}
            route={routeAfter} label="DIFFERENCE"
            sub={diff ? `max |dSIC| ${diff.vmax.toFixed(3)}` : 'D0 → D3'}
            tone="diff" onClick={onViewDiff} active
          />
        </div>

        {!before || !after ? (
          <div className="hint">
            {loading
              ? 'Reading both real SIC frames\u2026'
              : 'Run DYNAMIC REROUTE to load the AFTER frame and the difference field.'}
          </div>
        ) : (
          <>
            <div className="cmp">
              <div className="cmp-h">SIC field &mdash; real artifact comparison</div>
              <div className="cmp-hd">
                <span>Metric</span><span>BEFORE</span><span>AFTER</span><span>&Delta;</span>
              </div>
              <CmpRow label="Date" a={beforeLabel} b={afterLabel} d="" />
              <CmpRow label="Mean SIC" a={sB.mean} b={sA.mean} d={4} />
              <CmpRow label="Max SIC" a={sB.max} b={sA.max} d={4} />
              <CmpRow label="Navigable" a={sB.n_navigable} b={sA.n_navigable} d={0} int />
              <CmpRow
                label="Non-navigable" a={sB.n_non_navigable} b={sA.n_non_navigable} d={0} int
              />
            </div>

            {diff ? (
              <div className="diff-sum">
                <div className="ds">
                  <span className="k">Cells with SIC increase</span>
                  <b className="hot">{count(diff.nIncreased)}</b>
                </div>
                <div className="ds">
                  <span className="k">Cells with SIC decrease</span>
                  <b className="cold">{count(diff.nDecreased)}</b>
                </div>
                <div className="ds">
                  <span className="k">Navigability flips</span>
                  <b className={diff.nNavChanged ? 'hot' : 'calm'}>{count(diff.nNavChanged)}</b>
                </div>
                <div className="ds">
                  <span className="k">Max |&Delta;SIC|</span>
                  <b>{diff.vmax.toFixed(4)}</b>
                </div>
              </div>
            ) : null}

            <div className="ramp-mini">
              <span className="k">Difference key</span>
              <span className="sw" style={{ background: '#0a101a' }} /> unchanged
              <span className="sw" style={{ background: '#12b3e0' }} /> ice retreated
              <span className="sw" style={{ background: '#f6a11a' }} /> ice advanced
              <span className="sw" style={{ background: '#facc15' }} /> became non-navigable
              <span className="sw" style={{ background: '#38bdf8' }} /> became navigable
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function CmpRow({ label, a, b, d, int }) {
  const fmt = (v) => {
    if (v == null) return '—'
    return int ? count(v) : Number(v).toFixed(d)
  }
  let dtxt = '—'
  let dcls = 'same'
  if (typeof a === 'number' && typeof b === 'number' && d !== '') {
    const diff = b - a
    if (Math.abs(diff) < (int ? 0.5 : Math.pow(10, -d) / 2)) dtxt = '='
    else {
      dtxt = `${diff > 0 ? '+' : '−'}${int ? count(Math.abs(diff)) : Math.abs(diff).toFixed(d)}`
      dcls = diff > 0 ? 'up' : 'dn'
    }
  }
  return (
    <div className="cmp-row">
      <span className="lbl">{label}</span>
      <span>{fmt(a)}</span>
      <span>{fmt(b)}</span>
      <span className={`d ${dcls}`}>{dtxt}</span>
    </div>
  )
}
