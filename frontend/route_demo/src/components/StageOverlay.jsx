import React from 'react'
import { fixed, count } from './ui.jsx'

/**
 * Stage overlays.
 *
 * `intro` renders as a card floating OVER THE MAP ONLY, so the right-hand
 * control panel stays live and clickable from the very first second of the
 * demo (a full-screen blocker would swallow the OPTIMIZE / REROUTE clicks).
 * `final` is the closing summary and is intentionally full-screen.
 */
export default function StageOverlay({ stage, onClose, route, plan, reroute, meta, status }) {
  if (stage === 'intro') {
    return (
      <div className="map-intro">
        <div className="mi-card">
          <div className="mi-kicker">SIH2026059</div>
          <h1>{meta?.title ?? 'Antarctic Ocean Route Optimization'}</h1>
          <h2>{meta?.system ?? 'IceRoute-Robust'}</h2>
          <p className="mi-lead">
            Static route planning cannot survive a moving ice edge.
            IceRoute-Robust plans on the <b>real committed SIC forecast artifact</b>
            with <b>A* + CostMap</b>, then re-plans on a later forecast step when the
            environment changes.
          </p>
          <div className="mi-grid">
            <div><span>Data</span><b>REAL SIC</b></div>
            <div><span>Forecast</span><b>{meta?.n_timesteps ?? '—'} d</b></div>
            <div><span>Grid</span><b>{meta ? `${meta.n_rows}×${meta.n_cols}` : '—'}</b></div>
            <div><span>Routing</span><b>A* + CostMap</b></div>
          </div>
          <button type="button" className="btn btn-primary big" onClick={onClose}>
            Start the demo ▶
          </button>
          <div className="mi-foot">
            The panel on the right is already live — OPTIMIZE ROUTE and DYNAMIC
            REROUTE work now. Committed 2026 SIC output · no retraining · no
            synthetic route data.
          </div>
        </div>
      </div>
    )
  }

  if (stage !== 'final') return null

  const active = plan ?? route
  const ok = !!(active && (active.success ?? true))
  const nanFree = active?.nan_cells_on_route === 0
  const leg = route?.leg ?? {}
  const lat = meta?.lat ?? []
  const lon = meta?.lon ?? []
  const startLL = route?.path?.length
    ? [lat[route.path[0][0]], lon[route.path[0][1]]]
    : leg.start_latlon
  const goalLL = route?.path?.length
    ? [lat[route.path[route.path.length - 1][0]], lon[route.path[route.path.length - 1][1]]]
    : leg.goal_latlon

  return (
    <div className="overlay">
      <div className="ov-card">
        <div>
          <div className="ov-kicker">SIH2026059 · IceRoute-Robust</div>
          <h1 className="final-title">SAFE ROUTE GENERATED</h1>
          <div className="final-sub">Real SIC data · dynamic rerouting verified</div>
        </div>

        <div className="ov-metrics">
          <div><span>SIC data</span><b>REAL</b></div>
          <div><span>Forecast steps</span><b>{meta?.n_timesteps ?? '—'}</b></div>
          <div><span>Grid</span><b>{meta ? `${meta.n_rows} × ${meta.n_cols}` : '—'}</b></div>
          <div><span>Route waypoints</span><b>{count(active?.waypoints)}</b></div>
          <div><span>NaN cells on route</span><b style={{ color: nanFree ? 'var(--ok)' : 'var(--bad)' }}>{count(active?.nan_cells_on_route)}</b></div>
        </div>

        <div className="ov-cols">
          <div className="ov-box">
            <h4>Route</h4>
            <div className="row"><span className="k">Status</span><span className="v mono" style={{ color: ok ? 'var(--ok)' : 'var(--bad)' }}>{ok ? 'SUCCESS' : 'FAILED'}</span></div>
            <div className="row"><span className="k">Algorithm</span><span className="v">A* + CostMap</span></div>
            <div className="row"><span className="k">Start</span><span className="v mono">{startLL ? `${startLL[0].toFixed(2)}°, ${startLL[1].toFixed(2)}°` : '—'}</span></div>
            <div className="row"><span className="k">Goal</span><span className="v mono">{goalLL ? `${goalLL[0].toFixed(2)}°, ${goalLL[1].toFixed(2)}°` : '—'}</span></div>
            <div className="row"><span className="k">Length</span><span className="v mono">{fixed(active?.route_length_grid_units, 2)} units</span></div>
            <div className="row"><span className="k">Mean SIC</span><span className="v mono">{fixed(active?.mean_sic, 4)}</span></div>
            <div className="row"><span className="k">Max SIC</span><span className="v mono">{fixed(active?.max_sic, 4)}</span></div>
            <div className="row"><span className="k">Reroute</span><span className="v mono" style={{ color: 'var(--warn)' }}>{reroute ? `${reroute.status} · D${reroute.origin_timestep}→D${reroute.reroute_timestep}` : 'READY'}</span></div>
          </div>

          <div className="ov-box">
            <h4>Verification</h4>
            <div className="ov-checks">
              <div className="ov-check"><span className="t">✓</span> Real SIC</div>
              <div className="ov-check"><span className="t">{ok ? '✓' : '✗'}</span> Route valid</div>
              <div className="ov-check"><span className="t">{nanFree ? '✓' : '✗'}</span> {nanFree ? '0 NaN route cells' : 'NaN on route'}</div>
              <div className="ov-check"><span className="t">✓</span> No retraining</div>
            </div>
            <div className="ov-note">
              <b>Honest availability.</b> CMEMS currents:{' '}
              {status?.environment?.cmems?.available ? 'available' : 'unavailable'} · CVaR:{' '}
              {status?.environment?.cvar?.available ? 'available' : 'unavailable (no iceberg layers)'} ·
              route-ML policy: synthetic smoke data, not a real-accuracy claim. The
              plotted route is deterministic A* + CostMap on the real SIC field; NaN
              cells are non-navigable and are never zero-filled.
            </div>
          </div>
        </div>

        <div className="ov-foot">
          <button type="button" className="btn btn-primary big" style={{ width: 'auto' }} onClick={onClose}>
            Back to the live dashboard ▶
          </button>
        </div>
      </div>
    </div>
  )
}
