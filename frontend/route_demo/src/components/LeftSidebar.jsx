import React from 'react'
import SideSection from './SideSection.jsx'
import StageList from './StageList.jsx'
import LayerPanel from './LayerPanel.jsx'
import { ActionButton } from './ui.jsx'

/**
 * LEFT SIDEBAR — controls only.
 *
 * Nothing here competes with the chart: the demo script, the layer switches,
 * the field selector and the two route commands are all compact and always
 * reachable. Deep analysis lives on the right, behind expandable detail.
 */
export default function LeftSidebar({
  className = '', meta, stage, setStage, flashKey,
  layers, setLayers, availability,
  renderMode, setRenderMode, diffAvailable,
  busy, plan, route, reroute,
  onOptimize, onReroute,
  legend, onClose,
}) {
  const wp = plan?.waypoints ?? route?.waypoints
  const last = (meta?.n_timesteps ?? 1) - 1

  return (
    <nav className={`sbar sbar-l ${className}`} aria-label="Demo controls">
      <div className="sbar-head">
        <div className="sbh-top">
          <span className="sbh-mark" aria-hidden="true">&#129517;</span>
          <span className="sbh-t">IceRoute-Robust</span>
        </div>
        <span className="sbh-s">SIH2026059 · autonomous ops console</span>
      </div>

      <div className="sbar-scroll scroll-y">
        <SideSection title="Demo Stage" icon="1" open>
          <StageList stage={stage} setStage={setStage} flashKey={flashKey} />
        </SideSection>

        <SideSection title="Map Layers" icon="&#9635;" open tone="layers">
          <LayerPanel
            layers={layers}
            setLayers={setLayers}
            availability={availability}
            bare
          />
        </SideSection>

        <SideSection title="Chart Field" icon="&#9707;" tone="field">
          <div className="fieldsel">
            {[
              ['sic', 'SIC', false],
              ['uncertainty', 'Uncertainty', false],
              ['diff', 'Difference', !diffAvailable],
            ].map(([k, label, off]) => (
              <button
                key={k}
                type="button"
                className={`fs-b ${renderMode === k ? 'on' : ''} ${off ? 'off' : ''}`}
                disabled={off}
                title={
                  k === 'diff' && off
                    ? 'Run DYNAMIC REROUTE to compute the D0 \u2192 D3 difference field'
                    : `Render the map field as ${label}`
                }
                onClick={() => setRenderMode(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </SideSection>

        <SideSection title="Map Legend" icon="&#9636;" tone="legend">
          {legend}
        </SideSection>

        <SideSection title="Data &amp; Integrity" icon="&#8801;" tone="data">
          <div className="prov">
            <div><b>Data</b> routing_sic_2026.npy</div>
            <div><b>Window</b> {meta ? `${meta.date_range[0]} \u2192 ${meta.date_range[1]}` : '\u2014'}</div>
            <div><b>Grid</b> {meta ? `${meta.n_rows} \u00d7 ${meta.n_cols} @ ${meta.resolution_deg}\u00b0` : '\u2014'}</div>
            <div><b>Extent</b> {meta ? `lat ${meta.lat_range[0]}\u2026${meta.lat_range[1]} · lon ${meta.lon_range[0]}\u2026${meta.lon_range[1]}` : '\u2014'}</div>
            <div><b>Waypoints</b> {wp != null ? wp : '\u2014'}</div>
            <div><b>Reroute</b> {reroute ? reroute.status : 'ready'}</div>
          </div>
          <div className="hint">
            NaN = non-navigable (never zero-filled) · no retraining · no synthetic
            route data · {meta?.n_timesteps ?? '\u2014'} real SIC timesteps D0\u2013D{last}.
          </div>
        </SideSection>
      </div>

      {/* ---- always-visible command dock ---- */}
      <div className="dock">
        <div className="dock-rows">
          <div className="dock-row">
            <span className="dk-tag">Route</span>
            <span className="dk-dots">
              <i className={busy.route || wp != null ? 'ok' : ''} />
              <i className={busy.route ? 'on' : ''} />
              <i className={plan?.success ? 'ok' : ''} />
            </span>
            <span className={`dk-v ${busy.route ? 'busy' : plan?.success ? 'ok' : ''}`}>
              {busy.route ? 'SOLVING\u2026'
                : plan?.success ? `${plan.waypoints} wp \u00b7 ${Number(plan.route_length_grid_units).toFixed(1)} u`
                  : route ? `${route.waypoints} wp (artifact)` : '\u2014'}
            </span>
          </div>
          <div className="dock-row">
            <span className="dk-tag">Reroute</span>
            <span className="dk-dots">
              <i className={reroute ? 'ok' : ''} />
              <i className={busy.reroute ? 'on' : ''} />
              <i className={reroute ? 'ok' : ''} />
            </span>
            <span className={`dk-v ${busy.reroute ? 'busy' : reroute ? 'ok' : ''}`}>
              {busy.reroute ? 'REPLANNING\u2026'
                : reroute ? `${reroute.status} \u00b7 jaccard ${Number(reroute.comparison?.jaccard_overlap ?? 0).toFixed(2)}`
                  : 'READY D0 \u2192 D3'}
            </span>
          </div>
        </div>
        <ActionButton
          tone="primary"
          busy={busy.route}
          busyLabel="OPTIMIZING\u2026"
          onClick={onOptimize}
        >
          &#9881; Optimize Route
        </ActionButton>
        <ActionButton
          tone="warn"
          busy={busy.reroute}
          busyLabel="REROUTING\u2026"
          onClick={onReroute}
        >
          &#8635; Dynamic Reroute
        </ActionButton>
      </div>

      {onClose ? (
        <button type="button" className="sbar-close" onClick={onClose} aria-label="close controls">
          &#10005;
        </button>
      ) : null}
    </nav>
  )
}
