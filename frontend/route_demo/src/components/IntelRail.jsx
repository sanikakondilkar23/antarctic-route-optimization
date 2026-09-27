import React, { useState } from 'react'
import SideSection from './SideSection.jsx'
import DataQuality from './DataQuality.jsx'
import DecisionPanel from './DecisionPanel.jsx'
import RouteProfile from './RouteProfile.jsx'
import EnvCompare from './EnvCompare.jsx'
import UncertaintyPanel from './UncertaintyPanel.jsx'
import SysIntel from './SysIntel.jsx'
import MiniField from './MiniField.jsx'
import { count, fixed } from './ui.jsx'

/**
 * RIGHT SIDEBAR — compact intelligence.
 *
 * Five stacked cards, each of which is a short honest readout by default and
 * a full analysis panel on demand. Nothing was removed: every panel that used
 * to sit in a scrolling column is still reachable, one caret away, so the map
 * can own the screen without losing a single number.
 */
export default function IntelRail({ data: d, focus, onFocus, className = '', onClose }) {
  const s = d.slice?.stats
  const total = s?.n_cells ?? (d.meta ? d.meta.n_rows * d.meta.n_cols : null)
  const navPct = s?.n_navigable != null && total ? (s.n_navigable / total) * 100 : null

  return (
    <aside className={`sbar sbar-r intel ${className}`} aria-label="Route intelligence">
      <div className="sbar-scroll scroll-y">

        {/* ------------------------------------------------ ENVIRONMENT */}
        <ICard
          id="env"
          title="Environment"
          icon="&#9634;"
          badge={d.slice ? `D${d.slice.timestep}` : '\u2014'}
          badgeTone="info"
          active={focus === 'env'}
          onFocus={onFocus}
          detailTitle="Data quality \u00b7 observed field"
        >
          <Kv k="Date" v={d.slice?.date ?? '\u2014'} hi />
          <Kv k="Forecast step" v={`D${d.slice?.timestep ?? 0}`} />
          <Kv k="SIC mean" v={fixed(s?.mean, 4)} />
          <Kv k="SIC max" v={fixed(s?.max, 4)} tone="warn" />
          <Kv
            k="Navigable"
            v={s?.n_navigable == null ? '\u2014' : `${count(s.n_navigable)} \u00b7 ${navPct.toFixed(1)}%`}
            tone="ok"
            title="Cells with a finite SIC value. NaN cells are non-navigable and are never zero-filled."
          />
          <SideSection title="Data quality \u00b7 observed field" icon="&#9707;">
            <DataQuality slice={d.slice} meta={d.meta} uncertainty={d.uncertainty} />
            <EnvMini
              slice={d.slice}
              lat={d.lat}
              lon={d.lon}
              route={d.primaryRoute}
              date={d.slice?.date}
            />
          </SideSection>
        </ICard>

        {/* ------------------------------------------------------- ROUTE */}
        <ICard
          id="route"
          title="Route"
          icon="&#9670;"
          badge={d.busy.route ? 'solving' : d.plan?.success ? 'SUCCESS' : d.route ? 'artifact' : 'idle'}
          badgeTone={d.busy.route ? 'busy' : d.plan?.success ? 'ok' : ''}
          active={focus === 'route'}
          onFocus={onFocus}
          detailTitle="Route decision \u00b7 risk profile"
        >
          <Kv
            k="Status"
            v={d.busy.route ? 'OPTIMIZING\u2026'
              : d.plan?.success ? 'SUCCESS' : d.route ? 'VERIFIED ARTIFACT' : 'NOT RUN'}
            tone={d.plan?.success ? 'ok' : 'info'}
            hi
          />
          <Kv k="Waypoints" v={count(d.src?.waypoints)} />
          <Kv k="Length" v={d.src?.route_length_grid_units == null ? '\u2014' : `${fixed(d.src.route_length_grid_units, 2)} u`} />
          <Kv k="Mean SIC" v={fixed(d.src?.mean_sic, 4)} />
          <Kv k="Max SIC" v={fixed(d.src?.max_sic, 4)} tone="warn" />
          <Kv
            k="NaN on route"
            v={d.src?.nan_cells_on_route ?? '\u2014'}
            tone={d.src?.nan_cells_on_route === 0 ? 'ok' : 'warn'}
            title="Every waypoint must sit on a real, finite SIC cell."
          />
          <SideSection title="Route decision \u00b7 risk profile" icon="&#9670;">
            <DecisionPanel plan={d.plan} route={d.route} busy={d.busy.route} result={d.planResult} />
            <section className="card card-risk">
              <header className="card-head">
                <span className="ic">&#9650;</span>
                <h3>Route Risk Profile</h3>
                <span className={`card-badge ${d.profile ? 'ok' : ''}`}>
                  {d.profile ? `${d.profile.samples?.length ?? 0} samples` : 'off'}
                </span>
              </header>
              <div className="card-body">
                <RouteProfile profile={d.profile} vesselT={d.vesselT} loading={d.busy.profile} />
                <div className="mgrid">
                  <div className="m">
                    <div className="l">Max SIC</div>
                    <div className="v tone-warn">
                      {d.profile?.max_sic == null ? '\u2014' : Number(d.profile.max_sic).toFixed(4)}
                    </div>
                  </div>
                  <div className="m">
                    <div className="l">Mean SIC</div>
                    <div className="v">
                      {d.profile?.mean_sic == null ? '\u2014' : Number(d.profile.mean_sic).toFixed(4)}
                    </div>
                  </div>
                  <div className="m">
                    <div className="l">NaN cells</div>
                    <div className="v">
                      {d.profile?.nan_cells_on_route == null ? '\u2014' : d.profile.nan_cells_on_route}
                    </div>
                  </div>
                  <div className="m">
                    <div className="l">Length</div>
                    <div className="v">
                      {d.profile?.great_circle_length_km == null
                        ? '\u2014'
                        : `${Number(d.profile.great_circle_length_km).toFixed(0)}km`}
                    </div>
                  </div>
                </div>
                <div className="hint">
                  X: route progress on the real 0.25&deg; grid · Y: real SIC at the
                  occupied cell. Sample values come from GET /api/route/profile.
                </div>
              </div>
            </section>
          </SideSection>
        </ICard>

        {/* ---------------------------------------------------- REROUTING */}
        <ICard
          id="change"
          title="Rerouting"
          icon="&#8635;"
          badge={d.busy.reroute ? 'working' : d.reroute ? d.reroute.status : 'ready'}
          badgeTone={d.busy.reroute ? 'busy' : d.reroute ? 'ok' : ''}
          active={focus === 'change'}
          onFocus={onFocus}
          detailTitle="Environment change \u00b7 comparison"
        >
          <Kv k="Leg" v={`D${d.originStep} \u2192 D${d.reroute ? d.reroute.reroute_timestep : d.targetStep}`} hi />
          <Kv
            k="Status"
            v={d.busy.reroute ? 'REPLANNING\u2026' : d.reroute ? d.reroute.status : 'READY \u2014 press Dynamic Reroute'}
            tone={d.reroute ? (d.reroute.status === 'SUCCESS' ? 'ok' : 'bad') : 'info'}
          />
          {d.reroute ? (
            <>
              <Kv k="Jaccard overlap" v={Number(d.reroute.comparison?.jaccard_overlap ?? 0).toFixed(3)} />
              <Kv k="Route coverage" v={Number(d.reroute.comparison?.route_coverage ?? 0).toFixed(3)} />
              <Kv
                k="Changed cells"
                v={`${d.reroute.comparison?.changed_cells ?? 0}${(d.reroute.comparison?.changed_cells ?? 0) === 0 ? ' \u00b7 corridor safe' : ''}`}
                tone={d.reroute.comparison?.changed_cells === 0 ? 'ok' : 'warn'}
              />
            </>
          ) : null}
          <SideSection title="Environment change \u00b7 comparison" icon="&#8644;">
            <EnvCompare
              before={d.beforeSlice}
              after={d.afterSlice}
              diff={d.diff}
              lat={d.lat}
              lon={d.lon}
              routeBefore={d.originRoute || d.primaryRoute}
              routeAfter={d.reroute?.rerouted_route?.path || null}
              beforeLabel={`D${d.originStep} \u00b7 ${d.beforeSlice?.date ?? '\u2014'}`}
              afterLabel={d.afterSlice ? `D${d.targetStep} \u00b7 ${d.afterSlice.date}` : `D${d.targetStep} \u00b7 \u2014`}
              comparison={d.reroute?.comparison}
              loading={d.busy.reroute}
              onViewDiff={() => d.setRenderMode((m) => (m === 'diff' ? 'sic' : 'diff'))}
            />
            {d.reroute ? (
              <section className="card card-reroute">
                <header className="card-head">
                  <span className="ic">&#8635;</span>
                  <h3>Reroute Comparison</h3>
                  <span className={`card-badge ${d.reroute.status === 'SUCCESS' ? 'ok' : 'bad'}`}>
                    {d.reroute.status}
                  </span>
                </header>
                <div className="card-body">
                  <div className="mgrid c2">
                    <div className="m">
                      <div className="l">Original length</div>
                      <div className="v">{Number(d.reroute.original_route?.route_length_grid_units ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="m">
                      <div className="l">New length</div>
                      <div className="v">{Number(d.reroute.rerouted_route?.route_length_grid_units ?? 0).toFixed(2)}</div>
                    </div>
                    <div className="m">
                      <div className="l">Jaccard overlap</div>
                      <div className="v tone-ok">{Number(d.reroute.comparison?.jaccard_overlap ?? 0).toFixed(3)}</div>
                    </div>
                    <div className="m">
                      <div className="l">Route coverage</div>
                      <div className="v tone-ok">{Number(d.reroute.comparison?.route_coverage ?? 0).toFixed(3)}</div>
                    </div>
                  </div>
                  <div className="hint">
                    All three metrics are computed by the backend
                    (src/routing/scenario_router.py) from the two real paths.
                    A high overlap with a short horizon means the re-planned corridor
                    stayed inside the same safe water.
                  </div>
                  {d.rrResult ? (
                    <div className={`act ${d.rrResult.tone === 'ok' ? 'done' : d.rrResult.tone === 'bad' ? 'bad' : 'busy'}`}>
                      {d.rrResult.text}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
          </SideSection>
        </ICard>

        {/* ------------------------------------------------------ SYSTEM */}
        <ICard
          id="sys"
          title="System"
          icon="&#9673;"
          badge="audit"
          badgeTone="info"
          active={focus === 'sys'}
          onFocus={onFocus}
          detailTitle="Availability audit \u00b7 ensemble \u00b7 integrity"
        >
          <Sys
            ok
            k="REAL SIC"
            v={`${d.meta?.n_timesteps ?? '\u2014'} timesteps \u00b7 ${d.meta?.n_rows ?? '\u2014'} \u00d7 ${d.meta?.n_cols ?? '\u2014'}`}
          />
          <Sys
            ok={(d.meta?.uncertainty_horizons ?? 0) > 0}
            k="Uncertainty"
            v={`${d.meta?.uncertainty_horizons ?? '\u2014'} horizons \u00b7 ${(d.meta?.uncertainty_shape || []).join('\u00d7')}`}
          />
          <Sys
            ok={false}
            tone="warn"
            k="CMEMS"
            v={d.cmems?.available ? 'available' : 'UNAVAILABLE'}
            sub={d.cmems?.note || 'Drive mount not configured'}
          />
          <Sys
            ok={false}
            tone="warn"
            k="CVaR"
            v="UNAVAILABLE"
            sub="iceberg risk layers absent \u2014 no CVaR is computed or claimed"
          />
          <SideSection title="Availability audit \u00b7 ensemble \u00b7 integrity" icon="&#9673;">
            <SysIntel
              status={d.status}
              ensemble={d.ensemble}
              meta={d.meta}
              limitations={d.limitations}
            />
          </SideSection>
        </ICard>

        {/* ------------------------------------------------- UNCERTAINTY */}
        <ICard
          id="unc"
          title="Forecast Uncertainty"
          icon="&#9673;"
          badge={d.uncertainty ? `H${d.uncertainty.horizon + 1}` : '\u2014'}
          badgeTone={d.uncertainty ? 'ok' : ''}
          active={focus === 'unc'}
          onFocus={onFocus}
          detailTitle="Horizons \u00b7 committed distribution"
        >
          <Kv k="Lead horizon" v={`D+${d.horizon + 1}`} hi />
          <Kv k="Mean" v={d.uncertainty ? fixed(d.uncertainty.stats?.mean, 4) : '\u2014'} />
          <Kv k="Max" v={d.uncertainty ? fixed(d.uncertainty.stats?.max, 4) : '\u2014'} tone="warn" />
          <Kv
            k="Model band"
            v={d.uncertainty?.stats?.n_within_model_domain == null
              ? '\u2014'
              : `${count(d.uncertainty.stats.n_within_model_domain)} cells`}
            title="The uncertainty artifact covers the ConvLSTM model band only; outside it there is no value and none is assumed."
          />
          <SideSection title="Horizons \u00b7 committed distribution" icon="&#9673;">
            <UncertaintyPanel
              meta={d.meta}
              sic={d.slice}
              uncertainty={d.uncertainty}
              horizon={d.horizon}
              setHorizon={d.setHorizon}
              summary={d.uncSummary}
              loading={d.busy.unc}
              sideBySide={d.sideBySide}
              setSideBySide={d.setSideBySide}
              onOverlay={d.onOverlay}
            />
          </SideSection>
        </ICard>

      </div>

      {onClose ? (
        <button type="button" className="sbar-close" onClick={onClose} aria-label="close intelligence">
          &#10005;
        </button>
      ) : null}
    </aside>
  )
}

/* ------------------------------------------------------------------ */
/* Card + key/value primitives                                        */
/* ------------------------------------------------------------------ */
function ICard({ id, title, icon, badge, badgeTone, active, onFocus, children }) {
  const [open, setOpen] = useState(false)
  return (
    <section
      className={`icard ${active ? 'focus' : ''}`}
      ref={(el) => {
        // Scroll the focused card into view by moving the RAIL's own
        // scrollTop only. Element.scrollIntoView() would instead scroll every
        // scrollable ancestor including the document: on narrow viewports the
        // rail is a drawer translated off-screen, so the browser would drag
        // the whole dashboard sideways and push the map off the viewport.
        if (!el || !active) return
        const box = el.closest('.sbar-scroll')
        if (!box) return
        const top = el.offsetTop - box.offsetTop
        if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) {
          box.scrollTop = Math.max(0, top - 4)
        }
      }}
    >
      <div className="ic-head">
        <button
          type="button"
          className="ic-title"
          onClick={() => onFocus && onFocus(id)}
          title={`Focus ${title}`}
        >
          <span className="ic-ic" aria-hidden="true">{icon}</span>
          <span className="ic-t">{title}</span>
        </button>
        {badge ? <span className={`card-badge ${badgeTone || ''}`}>{badge}</span> : null}
        <button
          type="button"
          className="ic-caret"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? 'collapse' : 'expand'} ${title} detail`}
        >
          {open ? '\u2212' : '+'}
        </button>
      </div>
      <div className="ic-body">{children}</div>
    </section>
  )
}

function Kv({ k, v, tone, hi, title }) {
  return (
    <div className={`kv ${hi ? 'hi' : ''}`} title={title}>
      <span className="k">{k}</span>
      <b className={`v ${tone ? `t-${tone}` : ''}`}>{v}</b>
    </div>
  )
}

function Sys({ ok, tone, k, v, sub }) {
  const t = tone || (ok ? 'ok' : 'warn')
  return (
    <div className={`kv sys si-${t}`} title={sub}>
      <span className="k">{ok ? '\u2713' : '\u26a0'}</span>
      <b className={`v ${t === 'ok' ? 't-ok' : 't-warn'}`}>{k} &middot; {v}</b>
    </div>
  )
}

/** Small always-available context thumbnail for the environment card. */
function EnvMini({ slice, lat, lon, route, date }) {
  return (
    <section className="card card-envmini">
      <header className="card-head">
        <span className="ic">&#9636;</span>
        <h3>Observed Field</h3>
        <span className="card-badge">{date || '\u2014'}</span>
      </header>
      <div className="card-body">
        <MiniField
          slice={slice} lat={lat} lon={lon} mode="sic" route={route}
          label={`SIC  D${slice?.timestep ?? 0}`} sub={date} tone="before"
        />
        <div className="envmini-h">
          <b>SEA ICE CONCENTRATION</b>
          <span className="lb">0.0 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 0.5 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500 1.0</span>
        </div>
        <p className="hint">
          Real SIC for the selected forecast day, rasterised directly from
          routing_sic_2026.npy at 0.25&deg;. Non-navigable cells (NaN) are hatched
          grey and are never rendered as open water.
        </p>
      </div>
    </section>
  )
}
