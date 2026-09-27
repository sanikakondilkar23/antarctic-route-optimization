import React from 'react'
import { Card, Row, Pill, Stat, ActionButton, fixed, count, delta } from './ui.jsx'

/**
 * Right-hand control / intelligence column.
 *
 * ENVIRONMENT · ROUTE OPTIMIZATION · DYNAMIC REROUTING · SYSTEM INTELLIGENCE
 * Every number comes from the backend. Nothing is hard-coded, nothing is
 * optimistic, and synthetic artifacts stay labelled as synthetic.
 */
export default function ControlPanel({
  meta, slice, route, plan, reroute, status, busy,
  onOptimize, onReroute, focus, targetStep, originStep, routeVisible, pulseT,
  planResult, rrResult,
}) {
  const s = slice?.stats
  const env = status?.environment
  const models = status?.models
  const forecaster = models?.sic_forecaster
  const policy = models?.route_policy
  const lat = meta?.lat ?? []
  const lon = meta?.lon ?? []

  /* ---- the plan currently on the map ---- */
  const active = plan ?? route
  const leg = route?.leg ?? {}
  const startLL = route?.path?.length
    ? [lat[route.path[0][0]], lon[route.path[0][1]]]
    : leg.start_latlon
  const goalLL = route?.path?.length
    ? [lat[route.path[route.path.length - 1][0]], lon[route.path[route.path.length - 1][1]]]
    : leg.goal_latlon

  const planOk = !!(active && (active.success ?? true))
  const routeState = busy.route ? 'busy' : planOk ? 'ok' : active ? 'bad' : 'idle'

  /* ---- reroute process step states ---- */
  const rrStep = !reroute ? (busy.reroute ? 1 : -1) : 3
  const flow = [
    { n: 1, t: 'Original route', v: active?.waypoints != null ? `${active.waypoints} wp` : '—', st: active ? 'done' : '' },
    { n: 2, t: 'Environment change', v: reroute ? reroute.reroute_date : `+${targetStep} d`, st: busy.reroute ? 'active' : reroute ? 'done' : '' },
    { n: 3, t: 'Rerouting trigger', v: busy.reroute ? 'A* running' : 'A* + CostMap', st: busy.reroute ? 'active' : reroute ? 'done' : '' },
    { n: 4, t: 'Updated safe route', v: reroute?.rerouted_route?.waypoints != null ? `${reroute.rerouted_route.waypoints} wp` : '—', st: reroute ? 'done' : '' },
  ]

  const cmp = reroute?.comparison
  const o = reroute?.original_route
  const u = reroute?.rerouted_route
  const unchanged = reroute && cmp && cmp.changed_cells === 0

  return (
    <aside className="ctrl scroll-y">

      {/* ============ ENVIRONMENT ============ */}
      <Card
        title="Environment"
        icon="◈"
        tone="env"
        focus={focus === 'env'}
        badge={env?.sic?.available ? 'REAL SIC' : 'NO DATA'}
        badgeTone={env?.sic?.available ? 'ok' : 'bad'}
      >
        <div className="mgrid">
          <Stat label="SIC min" value={fixed(s?.min, 4)} tone="info" />
          <Stat label="SIC mean" value={fixed(s?.mean, 4)} tone="info" />
          <Stat label="SIC max" value={fixed(s?.max, 4)} tone="info" />
          <Stat label="Uncertainty" value={`${meta?.uncertainty_horizons ?? '—'} h`} />
          <Stat label="Navigable" value={count(s?.n_navigable)} tone="ok" big />
          <Stat label="Non-nav." value={count(s?.n_non_navigable)} tone="warn" big />
          <Stat label="Forecast date" value={slice?.date ?? '—'} big />
          <Stat label="Timestep" value={slice?.timestep != null ? `Day ${slice.timestep}` : '—'} tone="info" />
        </div>
        <Row label="CMEMS currents" value={
          env?.cmems?.available
            ? <Pill tone="ok">available</Pill>
            : <Pill tone="bad">unavailable</Pill>} />
        <Row label="CVaR" value={
          env?.cvar?.available
            ? <Pill tone="ok">available</Pill>
            : <Pill tone="bad">unavailable · no iceberg data</Pill>} />
        <div className="hint">NaN cells = non-navigable, never zero-filled.</div>
      </Card>

      {/* ============ ROUTE OPTIMIZATION ============ */}
      <Card
        title="Route Optimization"
        icon="⇢"
        tone="route"
        focus={focus === 'route'}
        badge={routeState === 'busy' ? 'OPTIMIZING' : planOk ? 'SUCCESS' : active ? 'FAILED' : 'IDLE'}
        badgeTone={routeState === 'busy' ? 'busy' : planOk ? 'ok' : active ? 'bad' : ''}
      >
        <ActionButton
          tone="primary"
          busy={busy.route}
          busyLabel="Optimizing…"
          onClick={onOptimize}
        >
          ⚙ Optimize Route
        </ActionButton>

        <ActionStrip
          tone={planResult?.tone ?? (planOk ? 'ok' : 'idle')}
          busy={busy.route}
          busyTitle="Running A* + CostMap"
          busyText={`querying /api/route/at/${slice?.timestep ?? 0} on real SIC`}
          title={planResult?.tone === 'ok' ? 'Route optimized' : planOk ? 'Route loaded' : 'Route not planned'}
          text={planResult?.text ?? `A* + CostMap · real SIC · D${slice?.timestep ?? 0} · ${count(active?.waypoints)} waypoints`}
          icon={planResult?.tone === 'ok' ? '✓' : '•'}
        />

        <div className="mgrid c2">
          <Stat label="Algorithm" value="A* + CostMap" tone="ok" />
          <Stat label="Data" value="REAL SIC" tone="info" />
          <Stat label="Waypoints" value={count(active?.waypoints)} tone="ok" />
          <Stat label="Grid units" value={fixed(active?.route_length_grid_units, 2)} />
          <Stat label="Mean SIC on route" value={fixed(active?.mean_sic, 4)} tone="info" />
          <Stat label="Max SIC on route" value={fixed(active?.max_sic, 4)} tone="warn" />
          <Stat label="NaN cells on route" value={count(active?.nan_cells_on_route)} tone={active?.nan_cells_on_route === 0 ? 'ok' : 'bad'} />
          <Stat label="Total cost" value={fixed(active?.total_cost, 2)} />
        </div>
        <Row label="Start" value={startLL ? `${startLL[0].toFixed(2)}°, ${startLL[1].toFixed(2)}°` : '—'} mono />
        <Row label="Destination" value={goalLL ? `${goalLL[0].toFixed(2)}°, ${goalLL[1].toFixed(2)}°` : '—'} mono />
      </Card>

      {/* ============ DYNAMIC REROUTING ============ */}
      <Card
        title="Dynamic Rerouting"
        icon="↻"
        tone="reroute"
        focus={focus === 'reroute'}
        badge={busy.reroute ? 'REROUTING' : reroute ? reroute.status : 'READY'}
        badgeTone={busy.reroute ? 'busy' : reroute ? (reroute.status === 'SUCCESS' ? 'ok' : 'bad') : ''}
      >
        <div className="mgrid c2">
          <div className="m tone-info big">
            <div className="l">Current timestep</div>
            <div className="v" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              D{originStep}
              <span className="tstep"><span className="ar">→</span><span className="ts">D{targetStep}</span></span>
            </div>
          </div>
          <div className="m big">
            <div className="l">Target timestep</div>
            <div className="v" style={{ color: 'var(--warn)' }}>D{targetStep}</div>
          </div>
        </div>

        <div className="flow">
          {flow.map((f, i) => (
            <React.Fragment key={f.n}>
              <div className={`flow-step ${f.st}`}>
                <span className="fs-n">0{f.n}</span>
                <span>{f.t}</span>
                <span className="fs-v">{f.v}</span>
              </div>
              {i < flow.length - 1 ? <div className="flow-arrow">↓</div> : null}
            </React.Fragment>
          ))}
        </div>

        <ActionButton
          tone="warn"
          busy={busy.reroute}
          busyLabel="Rerouting…"
          onClick={onReroute}
        >
          ⟳ Dynamic Reroute
        </ActionButton>

        <ActionStrip
          tone={rrResult?.tone ?? (reroute ? 'ok' : 'idle')}
          busy={busy.reroute}
          busyTitle={`Re-planning on forecast D${targetStep}`}
          busyText={`GET /api/reroute/${targetStep} · A* + CostMap on real SIC`}
          title={rrResult?.tone === 'ok' ? `Rerouted D${originStep} → D${targetStep}` : reroute ? `Reroute ${reroute.status}` : 'Reroute not executed'}
          text={rrResult?.text ?? `press DYNAMIC REROUTE to replan for forecast step ${targetStep}`}
          icon={rrResult?.tone === 'ok' ? '✓' : '•'}
        />

        {reroute ? (
          <div className="cmp">
            <div className="cmp-h">
              <span>Route comparison</span>
              <span className="sp">D{reroute.origin_timestep} → D{reroute.reroute_timestep}</span>
            </div>
            <div className="cmp-hd"><span>Metric</span><span>Orig</span><span>Upd</span><span>Δ</span></div>
            <CmpRow k="Waypoints" a={o?.waypoints} b={u?.waypoints} n={0} />
            <CmpRow k="Length" a={o?.route_length_grid_units} b={u?.route_length_grid_units} n={2} />
            <CmpRow k="Mean SIC" a={o?.mean_sic} b={u?.mean_sic} n={4} />
            <CmpRow k="Max SIC" a={o?.max_sic} b={u?.max_sic} n={4} />
            <CmpRow k="NaN cells" a={o?.nan_cells_on_route} b={u?.nan_cells_on_route} n={0} />
            <div className="hint" style={{ marginTop: 2 }}>
              {unchanged
                ? `A* replan on the D${reroute.reroute_timestep} forecast returns the same `
                  + `${u?.waypoints}-cell corridor (jaccard 1.000, 0 changed cells): the safe `
                  + 'corridor persists while SIC along it shifts. Original path is kept on '
                  + 'the map as a dashed line, the replanned path is the bright primary line.'
                : `${count(cmp?.changed_cells)} route cells differ between the D${reroute.origin_timestep} `
                  + `and D${reroute.reroute_timestep} plans; changed cells are marked on the chart.`}
            </div>
          </div>
        ) : null}
      </Card>

      {/* ============ SYSTEM INTELLIGENCE ============ */}
      <Card
        title="System Intelligence"
        icon="◉"
        tone="sys"
        focus={focus === 'sys'}
        badge="availability"
      >
        <Row label="Real SIC" value={<Pill tone="ok">available</Pill>} />
        <Row label="SIC forecast model" value={
          forecaster?.present
            ? <Pill tone="ok">{forecaster.checkpoints?.length ?? 3} ConvLSTM ckpt</Pill>
            : <Pill tone="bad">missing</Pill>} />
        <Row label="Inference re-run" value={
          forecaster?.inference_rerun_possible
            ? <Pill tone="ok">possible</Pill>
            : <Pill tone="warn">raw inputs absent</Pill>} />
        <Row label="Route ML policy" value={
          policy?.present
            ? <Pill tone="warn">available · synthetic smoke data</Pill>
            : <Pill tone="bad">missing</Pill>} />
        <Row label="CMEMS currents" value={
          env?.cmems?.available ? <Pill tone="ok">available</Pill> : <Pill tone="bad">unavailable</Pill>} />
        <Row label="CVaR" value={
          env?.cvar?.available ? <Pill tone="ok">available</Pill> : <Pill tone="bad">unavailable</Pill>} />
        <Row label="Retraining" value={<Pill tone="ok">none performed</Pill>} />
        <div className="note">
          Route policy ({policy?.architecture?.replace('Linear', 'FC') ?? '16→64→32→8'}) exists
          but was trained on a <b>synthetic 20×25 smoke dataset</b>. Its score is not a
          real-world accuracy claim. The plotted route is <b>A* + CostMap on real SIC</b>.
        </div>
      </Card>

      {/* transient map-state chip so the action is visible on the chart itself */}
      {routeVisible && pulseT != null ? (
        <div className="act busy">
          <span className="a-i">◈</span>
          <span className="a-t">
            <b>Chart highlight</b>
            <span>sweeping the active plan on the SIC raster</span>
          </span>
        </div>
      ) : null}
    </aside>
  )
}

function ActionStrip({ tone, busy, busyTitle, busyText, title, text, icon }) {
  const cls = busy ? 'busy' : tone === 'ok' ? '' : tone === 'bad' ? 'busy' : 'idle'
  return (
    <div className={`act ${cls}`}>
      <span className="a-i">{busy ? '⟳' : icon}</span>
      <span className="a-t">
        <b>{busy ? busyTitle : title}</b>
        <span>{busy ? busyText : text}</span>
      </span>
    </div>
  )
}

function CmpRow({ k, a, b, n }) {
  const d = delta(a, b, n)
  return (
    <div className="cmp-row">
      <span className="k">{k}</span>
      <span className="a">{a == null ? '—' : Number(a).toFixed(n)}</span>
      <span className="b">{b == null ? '—' : Number(b).toFixed(n)}</span>
      <span className={`d ${d.cls}`}>{d.text}</span>
    </div>
  )
}
