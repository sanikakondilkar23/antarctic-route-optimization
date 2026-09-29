import React from 'react'

/**
 * AURORA model-integration cards for the right rail.
 *
 * Three models, three cards, all fed by the AURORA backend:
 *
 *   ModelStatusCard   GET  /api/aurora/status        six-row runtime status
 *   IcebergCard       POST /api/aurora/analyze       real YOLOv8 SAR detection
 *   AnalysisCard      POST /api/aurora/analyze       unified workflow result
 *
 * HARD RULES
 *   - A status is whatever the backend reported. Nothing is upgraded to
 *     "READY" because a component exists on disk.
 *   - Detections without georeferencing show location = null and
 *     coordinate_space = "pixel". No lat/lon is ever invented.
 *   - The ETA is labelled as an assumption (distance / speed), never as a
 *     model output.
 */

/** Backend status vocabulary -> the CSS tone already used across the rail. */
export const STATUS_TONE = {
  READY: 'ok',
  'INTEGRATION READY': 'warn',
  'DATA UNAVAILABLE': 'idle',
  'MODEL UNAVAILABLE': 'bad',
  'GEOREFERENCING UNAVAILABLE': 'warn',
  ERROR: 'bad',
}

const tone = (status) => STATUS_TONE[status] || 'idle'

const fmt = (v, d = 3) =>
  v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d)
const fmtInt = (v) =>
  v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString()

function Row({ k, v, sub, t }) {
  return (
    <div className={`mrow ${t || ''}`}>
      <span className="mk">{k}</span>
      <span className="mv">
        {v}
        {sub ? <em>{sub}</em> : null}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1. MODEL STATUS — GET /api/aurora/status                            */
/* ------------------------------------------------------------------ */
export function ModelStatusCard({ status }) {
  const rows = status?.rows || []
  const counts = status?.counts

  return (
    <div className="card">
      <div className="card-h">
        <span>MODEL STATUS</span>
        {counts ? (
          <span className={`pill ${counts.error ? 'bad' : counts.unavailable ? 'warn' : 'ok'}`}>
            {counts.ready}/{counts.total} READY
          </span>
        ) : (
          <span className="pill idle">checking…</span>
        )}
      </div>

      {!status ? (
        <p className="empty">Reading real runtime checks from the AURORA API…</p>
      ) : (
        <>
          <div className="metrics">
            {rows.map((r) => (
              <Row key={r.label} k={r.label.toUpperCase()} v={r.status} t={tone(r.status)} />
            ))}
          </div>
          <div className="prov">
            <div className="prov-h">WHAT EACH CHECK MEANS</div>
            <ul>
              {rows.map((r) => (
                <li key={r.label}>
                  <b>{r.label}:</b> {r.detail}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2. ICEBERG DETECTION — YOLOv8 on a SAR tile                         */
/* ------------------------------------------------------------------ */
export function IcebergCard({
  model, samples, sample, setSample, confidence, setConfidence,
  onRun, onFile, busy, result, error,
}) {
  const geo = result?.georeferencing || model?.georeferencing
  const geoOk = !!geo?.available
  const gs = result?.status || (geoOk ? 'READY' : 'GEOREFERENCING UNAVAILABLE')

  return (
    <div className="card">
      <div className="card-h">
        <span>ICEBERG DETECTION</span>
        <span className={`pill ${geoOk ? 'ok' : 'warn'}`}>
          {result ? `${result.detection_count ?? 0} DETECTED` : (model?.model_status === 'ready' ? 'READY' : 'CHECKING…')}
        </span>
      </div>

      <div className="metrics">
        <Row k="MODEL" v="YOLOv8-nano" t={model?.model_status === 'ready' ? 'ok' : 'warn'} />
        <Row k="CHECKPOINT" v={model?.checkpoint_present ? 'present' : 'absent'}
          t={model?.checkpoint_present ? 'ok' : 'bad'} />
        <Row k="PARAMETERS" v={fmtInt(model?.parameters)} />
        <Row k="CONF / IOU" v={`${model?.confidence_threshold ?? '—'} / ${model?.iou_threshold ?? '—'}`} />
        <Row k="GEOREFERENCING" v={geoOk ? 'AVAILABLE' : 'UNAVAILABLE'} t={geoOk ? 'ok' : 'warn'} />
        {result ? (
          <>
            <Row k="DETECTIONS" v={fmtInt(result.detection_count)} t={result.detection_count ? 'ok' : 'idle'} />
            <Row k="COORDINATE SPACE" v={result.coordinate_space || 'pixel'} />
            <Row k="LOCATION" v={result.location == null ? 'null (not georeferenced)' : 'lon/lat'}
              t={result.location == null ? 'warn' : 'ok'} />
            <Row k="IMAGE" v={`${result.image_width ?? '—'} × ${result.image_height ?? '—'}`} />
            <Row k="RISK STATUS" v={result.risk_status || '—'} t="warn" />
            <Row k="ROUTE CONSUMES RISK" v={String(!!result.route_consumes_iceberg_risk)}
              t={result.route_consumes_iceberg_risk ? 'ok' : 'warn'} />
          </>
        ) : null}
      </div>

      {result?.detections?.length ? (
        <div className="seg-list">
          {result.detections.slice(0, 8).map((d, i) => (
            <div className="seg" key={i}>
              <span className="tag new">{d.class}</span>
              conf <b>{fmt(d.confidence, 3)}</b>
              <span className="muted">
                {' '}· bbox [{(d.bbox || []).map((n) => Math.round(n)).join(', ')}] · {d.coordinate_space}
              </span>
            </div>
          ))}
          {result.detections.length > 8 ? (
            <div className="muted">+ {result.detections.length - 8} more</div>
          ) : null}
        </div>
      ) : null}

      {result && !result.detections?.length ? (
        <p className="empty">
          The detector ran on this tile and returned <b>0</b> detections at
          confidence ≥ {result.confidence_threshold ?? confidence}. That is the
          model's real answer for this image.
        </p>
      ) : null}

      <div className="prov">
        <div className="prov-h">RUN THE DETECTOR</div>
        <div className="fc-row" style={{ marginBottom: 6 }}>
          <select className="sel sm" value={sample} onChange={(e) => setSample(e.target.value)}>
            {(samples?.samples || []).length ? (
              (samples.samples).map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))
            ) : (
              <option value="">no committed tiles</option>
            )}
          </select>
          <button type="button" className="btn btn-ghost sm" onClick={onFile}>
            upload…
          </button>
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            data-iceberg-file
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onFile(f)
              e.target.value = ''
            }}
          />
        </div>
        <div className="fc-row" style={{ marginBottom: 6 }}>
          <span className="fc-lab">CONF</span>
          <input
            className="rng"
            type="range"
            min={0.001}
            max={0.9}
            step={0.001}
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            aria-label="confidence threshold"
          />
          <b className="fc-date">{Number(confidence).toFixed(3)}</b>
        </div>
        <button
          type="button"
          className="btn btn-primary wide"
          onClick={onRun}
          disabled={busy}
        >
          {busy ? 'DETECTING…' : 'RUN ICEBERG DETECTION'}
        </button>
        {error ? <div className="fc-notice bad">{error}</div> : null}
        {result?.note ? (
          <div className="prov-warn" style={{ marginTop: 6 }}>{result.note}</div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 3. AURORA ANALYSIS — POST /api/aurora/analyze                       */
/* ------------------------------------------------------------------ */
export function AnalysisCard({ analysis, vesselSpeed, setVesselSpeed, onRun, busy, error }) {
  const env = analysis?.environment
  const sic = analysis?.sic
  const route = analysis?.route
  const rr = analysis?.rerouting

  return (
    <div className="card">
      <div className="card-h">
        <span>AURORA ANALYSIS</span>
        <span className={`pill ${analysis ? 'ok' : 'idle'}`}>
          {analysis ? `${analysis.route?.waypoints ?? '—'} WP` : 'NOT RUN'}
        </span>
      </div>

      <div className="fc-row" style={{ marginBottom: 6 }}>
        <span className="fc-lab">VESSEL SPEED (kn)</span>
        <input
          className="num xs"
          type="number"
          min={1}
          max={30}
          step={0.5}
          value={vesselSpeed}
          onChange={(e) => setVesselSpeed(Number(e.target.value))}
        />
        <button
          type="button"
          className="btn btn-primary sm"
          onClick={onRun}
          disabled={busy}
          title="Run SIC + iceberg + environment + route through POST /api/aurora/analyze"
        >
          {busy ? 'ANALYZING…' : 'RUN ANALYSIS'}
        </button>
      </div>

      {error ? <div className="fc-notice bad">{error}</div> : null}

      {!analysis ? (
        <p className="empty">
          Runs the unified workflow: environment check → SIC assessment →
          iceberg assessment → existing A* optimizer → risk-aware route with
          distance and ETA.
        </p>
      ) : (
        <>
          <div className="metrics">
            <Row k="FORECAST DAY" v={`D${route.timestep} · ${route.date}`} />
            <Row k="DISTANCE" v={route.distance.km != null ? `${fmtInt(route.distance.km)} km` : '—'}
              sub={route.distance.grid_units != null ? `${fmt(route.distance.grid_units, 1)} grid units` : null} />
            <Row k="ETA" v={route.eta.hours != null ? `${fmt(route.eta.hours, 1)} h` : '—'}
              sub={route.eta.days != null ? `${fmt(route.eta.days, 1)} days` : null} />
            <Row k="ETA BASIS" v={route.eta.basis} t="idle" />
            <Row k="WAYPOINTS" v={fmtInt(route.waypoints)} />
            <Row k="MAX SIC ON ROUTE" v={fmt(route.risk.max_sic)} />
            <Row k="MEAN SIC ON ROUTE" v={fmt(route.risk.mean_sic)} />
            <Row k="LAYERS IN COST" v={(route.risk.layers_in_cost || []).join(', ') || '—'} />
            <Row k="ICEBERG RISK" v="null — not georeferenced" t="warn" />
            <Row k="SAFETY VALIDATION" v={route.validation?.nan_cells === 0 ? 'PASS' : 'CHECK'} t={route.validation?.nan_cells === 0 ? 'ok' : 'bad'} />
          </div>

          <div className="prov">
            <div className="prov-h">SIC ASSESSMENT</div>
            <ul>
              <li>Frame <b>{sic.date}</b> (D+{sic.horizon}) · model status <b>{sic.model_status}</b></li>
              <li>Along route: mean SIC <b>{fmt(sic.along_route.mean)}</b>, max <b>{fmt(sic.along_route.max)}</b></li>
              <li>Uncertainty σ — mean <b>{fmt(sic.uncertainty.stats.mean)}</b>, max <b>{fmt(sic.uncertainty.stats.max)}</b></li>
            </ul>

            <div className="prov-h">ENVIRONMENT</div>
            <ul>
              {['wind', 'current', 'water', 'sic', 'uncertainty'].map((k) => {
                const layer = env?.[k]
                if (!layer) return null
                return (
                  <li key={k}>
                    <b>{layer.label}:</b> {layer.status} — weight{' '}
                    <b>{layer.cost_weight}</b>{layer.in_cost ? ' (in cost)' : ' (not in cost)'}
                  </li>
                )
              })}
            </ul>

            <div className="prov-h">DYNAMIC REROUTING</div>
            <ul>
              <li>{rr?.note || '—'}</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
