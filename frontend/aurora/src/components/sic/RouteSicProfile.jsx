import Badge from '../ui/Badge'
import { ErrorState, LoadingState } from '../ui/Status'
import RouteSicChart from './RouteSicChart'
import { sicColor } from '../../lib/auroraApi'
import { cn } from '../../lib/utils'

const BAND_ORDER = ['open_water', 'marginal_ice', 'moderate_pack', 'hard_pack', 'impassable', 'invalid']

const BAND_LABEL = {
  open_water: 'Open water',
  marginal_ice: 'Marginal ice',
  moderate_pack: 'Moderate pack',
  hard_pack: 'Hard pack',
  impassable: 'Impassable',
  invalid: 'No data (NaN)',
}

/** Band midpoint on the project's own SIC ramp; NaN has no colour. */
const bandFill = (k, lo, hi) => {
  if (k === 'invalid') return '#4A5560'
  const c = sicColor((Number(lo) + Number(hi)) / 2)
  return Array.isArray(c) ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : c
}

const num = (v, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : null)
const pct = (v) => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(2)} %` : '—')

function Tile({ label, value, unit, sub, tone }) {
  return (
    <div className="border border-graphite-600 bg-graphite-800 px-3 py-2.5">
      <p className="eyebrow">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cn('num text-[20px] font-medium leading-none', tone ?? 'text-white')}>{value}</span>
        {unit && <span className="text-[11px] font-medium text-mist">{unit}</span>}
      </p>
      {sub && <p className="mt-1 num text-[11.5px] text-mist">{sub}</p>}
    </div>
  )
}

function Field({ k, v, tone = '' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-graphite-700 py-[5px] last:border-0">
      <span className="text-[11.5px] text-mist">{k}</span>
      <span className={cn('num text-right text-[12px] text-white/90', tone)}>{v}</span>
    </div>
  )
}

/**
 * Sea-ice statistics for one optimised route, read entirely from
 * GET /api/route/profile/<timestep>.
 *
 * Nothing on this panel is derived in the browser: every number is a field of
 * the backend response. Wind, wave, current and iceberg terms are shown as
 * DATA UNAVAILABLE because this deployment serves no such field.
 */
export default function RouteSicProfile({ profile, loading, error, title = 'Route sea-ice profile', showChart = true }) {
  if (error) return <ErrorState title="Route profile unavailable" message={error.message || String(error)} />
  if (loading && !profile) return <LoadingState label="Reading route SIC profile" />
  if (!profile) return null

  const bands = profile.bands ?? {}
  const split = profile.cost_split ?? {}
  const bandRows = BAND_ORDER.filter((k) => bands[k]).map((k) => [k, bands[k]])
  const maxKm = Math.max(1, ...bandRows.map(([, b]) => Number(b.km) || 0))
  const weights = split.weights ?? {}
  const edges = Object.fromEntries((profile.band_edges ?? []).map((e) => [e.name, e]))

  return (
    <section className="border border-graphite-600 bg-graphite-850">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-graphite-600 px-3 py-2">
        <h2 className="eyebrow text-ice">{title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value="REAL" />
          <span className="num text-[11.5px] text-mist">
            {profile.date ?? '—'} · D+{profile.timestep} · {profile.waypoints} cells
          </span>
        </div>
      </header>

      {/* ------------------------------------------------ headline tiles */}
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
        <Tile
          label="Route distance"
          value={num(profile.great_circle_length_km, 1) ?? '—'}
          unit="km"
          sub={`${profile.waypoints} cells`}
        />
        <Tile
          label="Route cost"
          value={num(split.total_cost ?? profile.total_cost, 2) ?? '—'}
          unit="objective"
          sub={`SIC share ${pct(split.sic_share_pct)}`}
        />
        <Tile
          label="SIC on route"
          value={num(profile.mean_sic) ?? '—'}
          sub={`min ${num(profile.min_sic) ?? '—'} · max ${num(profile.max_sic) ?? '—'}`}
        />
        <Tile
          label="High-ice cells"
          value={String(profile.high_ice_cells ?? '—')}
          unit={`of ${profile.waypoints}`}
          sub={`${pct(profile.high_ice_cells_pct)} of cells · ${pct(profile.high_ice_km_pct)} of distance`}
          tone={(profile.high_ice_cells ?? 0) > 0 ? 'text-warn' : 'text-safe'}
        />
      </div>

      {/* ------------------------------------------------------ profile */}
      {showChart && <div className="px-3 pb-3">{<RouteSicChart profile={profile} />}</div>}

      {/* -------------------------------------------------------- bands */}
      <div className="border-t border-graphite-700 px-3 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="mono-label">SIC bands on the route</p>
          <p className="text-[10.5px] text-steel">
            threshold {profile.high_ice_threshold} · {profile.high_ice_threshold_label}
          </p>
        </div>

        <div className="mt-2 space-y-1.5">
          {bandRows.map(([k, b]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-[112px] shrink-0 text-[11.5px] text-mist">{BAND_LABEL[k] ?? k}</span>
              <div className="h-3 flex-1 border border-graphite-700 bg-graphite-900">
                <div
                  className="h-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, ((Number(b.km) || 0) / maxKm) * 100))}%`,
                    background: bandFill(k, edges[k]?.lo ?? 0, edges[k]?.hi ?? 1),
                  }}
                />
              </div>
              <span className="num w-[74px] shrink-0 text-right text-[11.5px] text-white/90">
                {Number(b.km).toFixed(1)} km
              </span>
              <span className="num w-[62px] shrink-0 text-right text-[11.5px] text-mist">{pct(b.km_pct)}</span>
              <span className="num w-[54px] shrink-0 text-right text-[11.5px] text-steel">{b.cells} c</span>
            </div>
          ))}
        </div>

        <div className="mt-2.5 grid gap-x-4 sm:grid-cols-2">
          <Field k="High-ice distance" v={`${num(profile.high_ice_km, 1) ?? '—'} km (${pct(profile.high_ice_km_pct)})`} />
          <Field k="NaN cells on route" v={String(profile.nan_cells_on_route ?? '—')} />
          <Field k="Distance-weighted mean SIC" v={num(profile.mean_sic_distance_weighted) ?? '—'} />
          <Field k="Max SIC cell index" v={String(profile.max_sic_index ?? '—')} />
        </div>
      </div>

      {/* ---------------------------------------------------- cost split */}
      <div className="border-t border-graphite-700 px-3 py-3">
        <p className="mono-label">Cost split</p>
        <div className="mt-1.5 grid gap-x-4 sm:grid-cols-2">
          <Field k="Total objective cost" v={num(split.total_cost, 3) ?? '—'} />
          <Field k="Sea-ice term (SIC)" v={num(split.sic_cost, 3) ?? '—'} />
          <Field k="Distance term" v={num(split.distance_cost, 3) ?? '—'} />
          <Field k="Environmental total" v={num(split.environmental_cost, 3) ?? '—'} />
          <Field k="Other environmental terms" v={num(split.other_environmental_cost, 3) ?? '—'} />
          <Field k="Unattributed residual" v={num(split.unattributed, 4) ?? '—'} tone="text-steel" />
          <Field k="SIC share of cost" v={pct(split.sic_share_pct)} />
          <Field k="Distance share of cost" v={pct(split.distance_share_pct)} />
        </div>

        <p className="mt-2 break-words font-mono text-[10.5px] leading-snug text-steel">{split.formula}</p>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {(split.terms_active ?? []).map((t) => (
            <span
              key={t}
              className="border border-graphite-600 bg-graphite-900 px-2 py-0.5 font-mono text-[10.5px] text-ice"
            >
              {t}
            </span>
          ))}
          {!(split.terms_active ?? []).length && (
            <span className="text-[11px] text-steel">No environmental term enabled.</span>
          )}
        </div>

        <div className="mt-2 grid gap-x-4 sm:grid-cols-3">
          <Field k="w_sic" v={String(weights.w_sic ?? '—')} />
          <Field k="w_distance" v={String(weights.w_distance ?? '—')} />
          <Field k="w_ice (iceberg)" v={String(weights.w_ice ?? '—')} tone="text-steel" />
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-steel">{split.note}</p>
      </div>

      {/* ------------------------------------------------ unavailable */}
      <div className="border-t border-graphite-700 px-3 py-2.5">
        <p className="mono-label">Not served by this deployment</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {['Wind', 'Wave', 'Ocean current', 'Iceberg risk in cost', 'Bathymetry'].map((n) => (
            <span
              key={n}
              className="border border-graphite-600 bg-graphite-900 px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-steel"
            >
              {n} · data unavailable
            </span>
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px] leading-relaxed text-steel">
          SIC is the only environmental term in the objective here ({'w_ice'}, {'w_wind'} and{' '}
          {'w_curr'} are 0). No wind, current or iceberg value is invented on this panel.
        </p>
      </div>

      <footer className="border-t border-graphite-700 px-3 py-2">
        <p className="mono-label truncate" title={profile.source}>
          source: {profile.source}
        </p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-steel">{profile.note}</p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-steel">{profile.coordinate_space}</p>
      </footer>
    </section>
  )
}
