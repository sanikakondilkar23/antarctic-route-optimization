import Badge from '../ui/Badge'
import { Unavailable } from '../ui/Status'
import RouteSicProfile from '../sic/RouteSicProfile'
import { cn } from '../../lib/utils'

function Tile({ label, value, unit, sub, note, tone }) {
  return (
    <div className="border border-graphite-600 bg-graphite-800 px-3 py-2.5">
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cn('num text-[20px] font-medium leading-none', tone ?? 'text-white')}>{value}</span>
        {unit && <span className="text-[11px] font-medium text-mist">{unit}</span>}
      </p>
      {sub && <p className="mt-1 num text-[11.5px] text-mist">{sub}</p>}
      {note && <p className="mt-1.5 text-[10.5px] leading-snug text-steel">{note}</p>}
    </div>
  )
}

function UnavailableTile({ label, reason }) {
  return (
    <div className="border border-graphite-600 bg-graphite-800 px-3 py-2.5">
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 text-[15px] font-medium leading-none text-steel">Data unavailable</p>
      <p className="mt-1.5 text-[10.5px] leading-snug text-steel">{reason}</p>
    </div>
  )
}

function AnalysisBlock({ title, children, tone }) {
  return (
    <div className="border-t border-graphite-700 pt-2.5 first:border-0 first:pt-0">
      <p className={cn('mono-label mb-1', tone)}>{title}</p>
      <div className="space-y-1 text-[12px] leading-relaxed text-mist">{children}</div>
    </div>
  )
}

function Stat({ k, v, tone = '' }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11.5px] text-mist">{k}</span>
      <span className={cn('num text-right text-[12px] text-white/90', tone)}>{v}</span>
    </div>
  )
}

const fmt = (v, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : null)

/**
 * Results + explanation for one POST /api/route/optimize response.
 * Every displayed quantity is a field of that response; anything the API does
 * not publish is rendered as `Data unavailable` with the reason.
 */
export default function RouteResult({ plan, limitations, layersData, profile }) {
  if (!plan) return null

  const unc = plan.validation?.layer_coverage?.sic_uncertainty
  const uncCovered = unc?.covered_route_cells
  const uncTotal = (unc?.covered_route_cells ?? 0) + (unc?.uncovered_route_cells ?? 0)
  const ls = plan.layer_status ?? layersData ?? {}
  const notAvailable = ls.not_available ?? []
  const inCost = plan.cost_breakdown?.layers_in_cost ?? []

  return (
    <>
      {/* ---------------------------------------------------------- */}
      <section className="border border-graphite-600 bg-graphite-850">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-graphite-600 px-3 py-2">
          <h2 className="eyebrow text-ice">Recommended route</h2>
          <span className="num text-[11.5px] text-mist">
            {plan.date} · D+{plan.timestep} · {plan.waypoints} cells
          </span>
        </header>

        <div className="grid grid-cols-2 gap-2 p-3">
          <Tile
            label="Distance"
            value={fmt(plan.route_length_km, 1) ?? '—'}
            unit="km"
            sub={`direct ${fmt(plan.direct_length_km, 1) ?? '—'} km`}
            note={`${fmt(plan.route_length, 1) ?? '—'} grid units along an 8-connected path`}
          />
          <Tile
            label="Objective cost"
            value={fmt(plan.total_cost, 2) ?? '—'}
            note={`terms in cost: ${inCost.join(', ') || '—'}`}
          />
          <Tile
            label="SIC exposure"
            value={fmt(plan.mean_sic, 3) ?? '—'}
            sub={`max ${fmt(plan.max_sic, 3) ?? '—'}`}
            note="mean / max concentration on the path"
          />
          {unc ? (
            <Tile
              label="Uncertainty"
              value={`${uncCovered}/${uncTotal}`}
              unit="cells"
              sub={unc.in_cost ? 'in objective (w_unc > 0)' : 'not in objective (w_unc = 0)'}
              note="route cells covered by the uncertainty product"
            />
          ) : (
            <UnavailableTile
              label="Uncertainty"
              reason="No aggregate uncertainty figure is published for a route."
            />
          )}
          <UnavailableTile
            label="Risk"
            reason="The API publishes no scalar route risk score. total_cost is the objective value, not a risk index."
          />
          <UnavailableTile
            label="Iceberg exposure"
            reason={
              limitations?.iceberg ??
              'Iceberg risk is not available: detections cannot be georeferenced in this deployment.'
            }
          />
        </div>

        <div className="border-t border-graphite-700 px-3 py-2.5">
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <Stat k="Validation · in bounds" v={String(plan.validation?.all_cells_in_bounds ?? '—')} />
            <Stat k="Validation · reaches goal" v={String(plan.validation?.reaches_goal ?? '—')} />
            <Stat k="Validation · 8-connected" v={String(plan.validation?.contiguous_8_connected ?? '—')} />
            <Stat
              k="Non-navigable cells on path"
              v={String(plan.nan_cells ?? '—')}
              tone={plan.nan_cells === 0 ? 'text-safe' : 'text-danger'}
            />
            <Stat k="Expanded nodes" v={String(plan.expanded_nodes ?? '—')} />
            <Stat k="Algorithm" v="A* + CostMap" />
          </div>

          {(plan.start?.snapped || plan.goal?.snapped) && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-warn">
              {[plan.start, plan.goal]
                .filter((e) => e?.snapped)
                .map(
                  (e, i) =>
                    `${i === 0 ? '' : ' · '}Endpoint snapped ${e.snap_radius_cells} cell(s) from (${e.requested?.lat}, ${e.requested?.lon})`
                )
                .join('')}
            </p>
          )}
          <p className="mono-label mt-2 truncate" title={plan.algorithm}>
            {plan.algorithm}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      <section className="border border-graphite-600 bg-graphite-850">
        <header className="border-b border-graphite-600 px-3 py-2">
          <h2 className="eyebrow">Route analysis</h2>
          <p className="mt-0.5 text-[11.5px] text-mist">Why this route?</p>
        </header>

        <div className="space-y-2.5 px-3 py-3">
          <AnalysisBlock title="Sea ice">
            <p>
              The path crosses water with mean SIC{' '}
              <span className="num text-white">{fmt(plan.mean_sic) ?? '—'}</span> and maximum{' '}
              <span className="num text-white">{fmt(plan.max_sic) ?? '—'}</span>. Sea-ice risk is the
              only environmental term currently in the objective.
            </p>
            <div className="mt-1.5 space-y-0.5 border border-graphite-700 bg-graphite-900 px-2.5 py-2">
              <Stat k="w_sic" v={String(plan.cost_weights?.w_sic ?? '—')} />
              <Stat k="sic_mean in cost" v={inCost.includes('sic_mean') ? 'yes' : 'no'} />
            </div>
          </AnalysisBlock>

          <AnalysisBlock title="Iceberg risk">
            <p className="text-steel">{limitations?.iceberg ?? 'No iceberg risk term is available.'}</p>
          </AnalysisBlock>

          <AnalysisBlock title="Environmental conditions">
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {(ls.real ?? []).map((n) => (
                <Badge key={`r-${n}`} value={n} tone="ok" dot={false} />
              ))}
              {(ls.partial ?? []).map((n) => (
                <Badge key={`p-${n}`} value={n} tone="warn" dot={false} />
              ))}
            </div>
            <p>Layers in the cost function: <span className="num text-white">{inCost.join(', ') || 'none'}</span>.</p>
            <p className="text-steel">Reported as not available: <span className="num">{notAvailable.join(', ') || 'none'}</span>.</p>
            <p className="mt-1 break-words font-mono text-[10.5px] leading-snug text-steel">
              {plan.cost_breakdown?.formula}
            </p>
          </AnalysisBlock>

          <AnalysisBlock title="Uncertainty">
            {unc ? (
              <p>
                The uncertainty product covers <span className="num text-white">{uncCovered}</span> of{' '}
                <span className="num text-white">{uncTotal}</span> cells on the path
                {unc.in_cost ? ' and is weighted into the objective.' : ' but is not weighted into the objective.'}
              </p>
            ) : (
              <p className="text-steel">Coverage not reported for this response.</p>
            )}
            <p className="text-steel">{limitations?.uncertainty}</p>
          </AnalysisBlock>

          <AnalysisBlock title="Distance">
            <p>
              Great-circle length along the path is{' '}
              <span className="num text-white">{fmt(plan.route_length_km, 1) ?? '—'} km</span>; the
              straight start-to-goal distance is{' '}
              <span className="num text-white">{fmt(plan.direct_length_km, 1) ?? '—'} km</span>.
              Distance enters the objective with weight{' '}
              <span className="num text-white">{String(plan.cost_weights?.w_distance ?? '—')}</span>.
            </p>
          </AnalysisBlock>
        </div>
      </section>

      {/* ---------------------------------------------------------- */}
      {profile && (
        <RouteSicProfile
          profile={profile.data}
          loading={profile.loading}
          error={profile.error}
          title="SIC along this route"
        />
      )}
    </>
  )
}
