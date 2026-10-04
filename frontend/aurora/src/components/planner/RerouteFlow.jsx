import { ArrowDown, RefreshCw, CheckCircle2, CircleDashed } from 'lucide-react'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import { cn } from '../../lib/utils'

const fmt = (v, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—')

function Step({ index, title, status = 'idle', children }) {
  const mark =
    status === 'done' ? (
      <CheckCircle2 size={13} className="text-emerald-400" />
    ) : status === 'active' ? (
      <RefreshCw size={13} className="animate-spin text-[#22E5F0]" />
    ) : (
      <CircleDashed size={13} className="text-mist/60" />
    )
  return (
    <div className="rounded-xl border border-white/10 bg-[#05182B]/70 overflow-hidden shadow-inner">
      <header className="flex items-center gap-2 border-b border-white/10 bg-[#0A2A4A]/30 px-3 py-2">
        {mark}
        <span className="font-mono text-[10px] text-[#A9DFFF] font-bold">{`0${index}`}</span>
        <span className="text-[12px] font-semibold tracking-wide text-white">{title}</span>
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  )
}

function Connector() {
  return (
    <div className="flex justify-center py-1" aria-hidden="true">
      <ArrowDown size={14} className="text-[#22E5F0]/60" />
    </div>
  )
}

function MiniStat({ k, v, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11.5px] text-mist">{k}</span>
      <span className={cn('font-mono text-[12px] text-white/90 font-medium', tone)}>{v}</span>
    </div>
  )
}

/**
 * Dynamic re-routing pipeline.
 *
 * Shown only when POST /api/route/reroute actually answers; if the endpoint is
 * unreachable the panel degrades to an honest "Integration Ready" notice
 * instead of a simulated sequence.
 */
export default function RerouteFlow({
  plan,
  reroute,
  busy,
  error,
  supported,
  targetOptions,
  target,
  setTarget,
  frameOrigin,
  frameTarget,
  costWeights,
  onRun,
}) {
  if (!plan) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#071D33]/90 backdrop-blur-xl shadow-2xl overflow-hidden">
        <header className="border-b border-white/10 bg-[#0A2A4A]/40 px-3.5 py-2.5">
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-[#22E5F0] font-bold">Dynamic rerouting</h2>
        </header>
        <div className="px-3.5 py-3.5">
          <p className="text-[10px] font-mono uppercase tracking-wider text-mist">Awaiting a planned route</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mist">
            Plan a route first; the pipeline replays it against a later forecast timestep.
          </p>
        </div>
      </section>
    )
  }

  if (supported === 'unavailable') {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#071D33]/90 backdrop-blur-xl shadow-2xl overflow-hidden">
        <header className="border-b border-white/10 bg-[#0A2A4A]/40 px-3.5 py-2.5">
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-[#22E5F0] font-bold">Dynamic rerouting</h2>
        </header>
        <div className="px-3.5 py-5 text-center">
          <p className="text-[15px] font-semibold text-white">Integration Ready</p>
          <p className="mx-auto mt-1.5 max-w-xs text-[11.5px] leading-relaxed text-mist">
            The re-route endpoint is not reachable from this session, so no before/after comparison
            is shown.
          </p>
        </div>
      </section>
    )
  }

  const original = plan
  const updated = reroute?.updated_route ?? null
  const cmp = reroute?.route_comparison ?? null

  return (
    <section className="border border-graphite-600 bg-graphite-850">
      <header className="flex items-center justify-between gap-2 border-b border-graphite-600 px-3 py-2">
        <h2 className="eyebrow">Dynamic rerouting</h2>
        <span className="mono-label">POST /api/route/reroute</span>
      </header>

      <div className="px-3 py-3">
        {/* 01 CURRENT ROUTE */}
        <Step index={1} title="Current route" status="done">
          <MiniStat k="Forecast date" v={`${original.date} (D+${original.timestep})`} />
          <MiniStat k="Cells" v={original.waypoints} />
          <MiniStat k="Length" v={`${fmt(original.route_length_km, 1)} km`} />
          <MiniStat k="Mean / max SIC" v={`${fmt(original.mean_sic)} / ${fmt(original.max_sic)}`} />
        </Step>
        <Connector />

        {/* 02 ENVIRONMENT UPDATE */}
        <Step index={2} title="Environment update" status={target != null ? 'done' : 'idle'}>
          <label className="input-label" htmlFor="reroute-target">
            Target forecast date
          </label>
          <select
            id="reroute-target"
            className="select font-mono text-[12.5px]"
            value={target ?? ''}
            onChange={(e) => setTarget(Number(e.target.value))}
            disabled={!targetOptions.length}
          >
            {!targetOptions.length && <option value="">no later date available</option>}
            {targetOptions.map(({ i, d }) => (
              <option key={d} value={i}>
                D+{i} · {d}
              </option>
            ))}
          </select>
          <div className="mt-2 space-y-0.5">
            <MiniStat
              k="SIC frame mean"
              v={
                frameOrigin && frameTarget
                  ? `${fmt(frameOrigin.stats?.mean, 4)} → ${fmt(frameTarget.stats?.mean, 4)}`
                  : '—'
              }
            />
            <MiniStat
              k="SIC frame max"
              v={
                frameOrigin && frameTarget
                  ? `${fmt(frameOrigin.stats?.max, 4)} → ${fmt(frameTarget.stats?.max, 4)}`
                  : '—'
              }
            />
            <MiniStat k="Frame date" v={frameTarget?.date ?? '—'} />
          </div>
        </Step>
        <Connector />

        {/* 03 RISK UPDATE */}
        <Step index={3} title="Risk update" status="done">
          <p className="text-[11.5px] leading-snug text-mist">
            Cost weights are server configuration and do not change between calls; what changes is
            the SIC surface those weights are applied to.
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
            {costWeights &&
              Object.entries(costWeights)
                .filter(([k]) => k !== 'vessel_draft_m')
                .map(([k, v]) => (
                  <span key={k} className="flex items-center justify-between gap-2">
                    <span className={Number(v) > 0 ? 'text-white/85' : 'text-steel'}>{k}</span>
                    <span className={Number(v) > 0 ? 'text-ice' : 'text-steel'}>{v}</span>
                  </span>
                ))}
          </div>
        </Step>
        <Connector />

        {/* 04 REROUTE */}
        <Step index={4} title="Reroute" status={busy ? 'active' : reroute ? 'done' : 'idle'}>
          <Button onClick={onRun} disabled={busy || target == null} className="w-full">
            {busy ? <RefreshCw size={14} className="animate-spin" /> : null}
            {busy ? 'Re-planning…' : 'Run reroute'}
          </Button>
          {error && <p className="mt-2 text-[11.5px] leading-relaxed text-danger">{error}</p>}
        </Step>

        {reroute && (
          <>
            <Connector />
            {/* 05 NEW ROUTE */}
            <Step index={5} title="New route" status="done">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge value={reroute.status ?? 'SUCCESS'} tone="ok" />
                <span className="num text-[11.5px] text-mist">
                  {reroute.origin_date} → {reroute.new_date} · D+{reroute.forecast_step_days}
                </span>
              </div>
              <MiniStat k="Length" v={`${fmt(updated?.route_length_km, 1)} km`} />
              <MiniStat k="Mean / max SIC" v={`${fmt(updated?.mean_sic)} / ${fmt(updated?.max_sic)}`} />
              <MiniStat k="Cells" v={String(updated?.waypoints ?? '—')} />
              <MiniStat k="Total cost" v={fmt(updated?.total_cost, 2)} />
              <div className="mt-2 border-t border-graphite-700 pt-2">
                <MiniStat k="Jaccard overlap" v={fmt(cmp?.jaccard_overlap, 3)} />
                <MiniStat k="Route coverage" v={fmt(cmp?.route_coverage, 3)} />
                <MiniStat
                  k="Changed cells"
                  v={String(cmp?.changed_cells ?? '—')}
                  tone={cmp?.changed_cells ? 'text-warn' : 'text-safe'}
                />
                <MiniStat k="Changed segments" v={String(reroute.changed_segments?.length ?? 0)} />
              </div>
              {reroute.change_explanation?.headline && (
                <p className="mt-2 text-[11.5px] font-semibold leading-snug text-white">
                  {reroute.change_explanation.headline}
                </p>
              )}
              {Array.isArray(reroute.change_explanation?.facts) &&
                reroute.change_explanation.facts.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {reroute.change_explanation.facts.map((fact) => (
                      <li key={fact} className="flex gap-1.5 text-[11px] leading-relaxed text-mist">
                        <span aria-hidden="true" className="text-cyan">
                          &rsaquo;
                        </span>
                        <span>{fact}</span>
                      </li>
                    ))}
                  </ul>
                )}
              <p className="mt-2 text-[11px] leading-relaxed text-steel">
                {reroute.environment_change_note}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-mist">
                Both corridors are drawn on the chart: dashed grey is the original, solid ice-blue is
                the re-planned route.
              </p>
            </Step>
          </>
        )}
      </div>
    </section>
  )
}
