import React from 'react'
import { count, fixed, Pill } from './ui.jsx'

/**
 * ROUTE DECISION — explainability.
 *
 * Everything in this panel comes from an API response. The "why" text only
 * describes what the repository actually implements
 * (src/routing/astar.py + src/routing/cost.py + src/data/sic_forecast.py);
 * it never claims a capability the code does not have.
 */
export default function DecisionPanel({ plan, route, busy, result, onOptimize }) {
  const src = plan || route
  const algo = src?.algorithm || 'A* + CostMap'
  const wp = src?.waypoints
  const len = src?.route_length_grid_units
  const mean = src?.mean_sic
  const max = src?.max_sic
  const nanOn = src?.nan_cells_on_route

  return (
    <section className="card card-route">
      <header className="card-head">
        <span className="ic">&#9670;</span>
        <h3>Route Decision</h3>
        <span className={`card-badge ${src ? 'ok' : busy ? 'busy' : ''}`}>
          {busy ? 'solving' : src ? 'explained' : 'not run'}
        </span>
      </header>
      <div className="card-body">
        <div className="flow">
          <FlowStep k="Algorithm" v={algo} done={!!src} />
          <div className="flow-arrow">&#9660;</div>
          <FlowStep k="Input" v="Real SIC forecast (routing_sic_2026.npy)" done={!!src} />
          <div className="flow-arrow">&#9660;</div>
          <FlowStep k="Constraints" v="NaN excluded \u00b7 SIC cost \u00b7 8-connectivity" done={!!src} />
          <div className="flow-arrow">&#9660;</div>
          <FlowStep k="Result" v={src ? `${wp} waypoints` : 'pending'} done={!!src} />
        </div>

        <div className="mgrid">
          <div className="m">
            <div className="l">Waypoints</div>
            <div className="v">{wp == null ? '—' : count(wp)}</div>
          </div>
          <div className="m">
            <div className="l">Length</div>
            <div className="v">{len == null ? '—' : fixed(len, 2)}<span style={{ fontSize: 9, opacity: 0.65 }}> u</span></div>
          </div>
          <div className="m">
            <div className="l">Mean SIC</div>
            <div className="v">{mean == null ? '—' : fixed(mean, 4)}</div>
          </div>
          <div className="m">
            <div className="l">Max SIC</div>
            <div className="v tone-warn">{max == null ? '—' : fixed(max, 4)}</div>
          </div>
        </div>

        <div className="na-check">
          <Pill tone={nanOn === 0 ? 'ok' : nanOn == null ? 'neutral' : 'bad'}>
            NaN cells on route: {nanOn == null ? '—' : nanOn}
          </Pill>
          {nanOn === 0 ? (
            <span className="na-note">Every waypoint sits on a real, finite SIC cell.</span>
          ) : null}
        </div>

        <div className="why">
          <div className="why-h">Why this route?</div>
          <p>
            Selected through the repository&apos;s safety-aware <code>CostMap</code> while
            avoiding non-navigable SIC cells.
          </p>
          <ul>
            <li>Non-navigable (NaN) cells are excluded from the search space, never zero-filled.</li>
            <li>Step cost = cell SIC + movement distance, both on the real 0.25&deg; grid.</li>
            <li>8-connected A* with a Euclidean heuristic over {wp == null ? '—' : count(wp)} cells.</li>
            <li>The ML policy is safety-gated and did <b>not</b> produce this route.</li>
          </ul>
        </div>

        {src?.total_cost != null ? (
          <div className="row">
            <span className="k">Total accumulated cost</span>
            <span className="v mono">{fixed(src.total_cost, 3)}</span>
          </div>
        ) : null}
        {src?.expanded_nodes != null ? (
          <div className="row">
            <span className="k">Nodes expanded</span>
            <span className="v mono">{count(src.expanded_nodes)}</span>
          </div>
        ) : null}
        {src?.date ? (
          <div className="row">
            <span className="k">Planned on</span>
            <span className="v mono">{src.date}</span>
          </div>
        ) : null}

        {result ? (
          <div className={`act ${result.tone === 'ok' ? 'done' : result.tone === 'bad' ? 'bad' : 'busy'}`}>
            {result.text}
            {result.date ? <span className="ad">{result.date}</span> : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function FlowStep({ k, v, done }) {
  return (
    <div className={`flow-step ${done ? 'done' : ''}`}>
      <span className="fs-k">{k}</span>
      <span className="fs-v">{v}</span>
    </div>
  )
}
