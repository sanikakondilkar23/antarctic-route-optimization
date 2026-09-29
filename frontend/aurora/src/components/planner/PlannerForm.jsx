import { MapPin, Crosshair, Navigation, RefreshCw, X } from 'lucide-react'
import { FloatPanel } from '../map/MapUi'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import { Checkbox } from '../ui/Forms'
import { ROUTE_POINTS, activeObjective } from '../../lib/auroraApi'
import { cn } from '../../lib/utils'

const CUSTOM = '__custom__'

function EndpointField({ title, value, onChange, presetId, onPreset, pickMode, onPick, error }) {
  const isCustom = presetId === CUSTOM
  return (
    <div className="border border-graphite-600 bg-graphite-800 px-3 py-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="input-label !mb-0">{title}</span>
        <span className={cn('mono-label', pickMode ? 'text-ice' : 'text-steel')}>
          {pickMode ? 'CLICKING ON MAP' : isCustom ? 'CUSTOM POINT' : 'PRESET'}
        </span>
      </div>

      <select
        className="select text-[13px]"
        value={presetId}
        onChange={(e) => onPreset(e.target.value)}
      >
        {ROUTE_POINTS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option value={CUSTOM}>Custom point (pick on map)</option>
      </select>

      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="num text-[12px] text-white/90">
          {Number(value.lat).toFixed(4)}°, {Number(value.lon).toFixed(4)}°
        </span>
        <button
          type="button"
          onClick={onPick}
          className={cn(
            'inline-flex items-center gap-1 rounded border px-2 py-1 text-[11.5px] font-medium transition',
            pickMode
              ? 'border-ice-dim bg-ice-dim/15 text-ice'
              : 'border-graphite-500 bg-graphite-750 text-mist hover:text-white'
          )}
        >
          {pickMode ? <X size={12} /> : <Crosshair size={12} />}
          {pickMode ? 'Cancel' : 'Pick on map'}
        </button>
      </div>

      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  )
}

function ObjectiveReadout({ weights, loading }) {
  const active = weights ? activeObjective(weights) : null
  if (loading && !weights) return <p className="text-[11.5px] text-mist">Reading active cost weights…</p>
  if (!weights)
    return <p className="text-[11.5px] leading-snug text-warn">Active cost weights unavailable — the objective cannot be stated.</p>
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge value={active ? 'ACTIVE PROFILE' : 'SERVER CUSTOM'} tone="info" />
        <span className="text-[12.5px] font-medium text-white">{active ? active.label : 'Unlisted weight set'}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-mist">{active ? active.hint : 'The backend reports weights matching no documented profile.'}</p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
        {Object.entries(weights)
          .filter(([k, v]) => k !== 'vessel_draft_m' && Number.isFinite(Number(v)))
          .map(([k, v]) => (
            <span key={k} className="flex items-center justify-between gap-2">
              <span className={Number(v) > 0 ? 'text-white/85' : 'text-steel'}>{k}</span>
              <span className={Number(v) > 0 ? 'text-ice' : 'text-steel'}>{v}</span>
            </span>
          ))}
      </div>
      <p className="text-[10.5px] leading-relaxed text-steel">
        Objective is server configuration (<span className="font-mono">SIH_W_*</span>) and is not
        selectable per request. The active set is echoed in every route response.
      </p>
    </div>
  )
}

export default function PlannerForm({
  metadata,
  layersData,
  layersLoading,
  origin,
  originPreset,
  onOriginPreset,
  goal,
  goalPreset,
  onGoalPreset,
  pickMode,
  setPickMode,
  timestep,
  setTimestep,
  snap,
  setSnap,
  onPlan,
  busy,
  planError,
  canPlan,
}) {
  const dates = metadata?.dates ?? []
  const weights = layersData?.cost_weights ?? null

  return (
    <FloatPanel title="Route planning" bodyClass="px-3 py-3 space-y-3">
      <div className="grid gap-2.5">
        <EndpointField
          title="Origin"
          value={origin}
          presetId={originPreset}
          onPreset={onOriginPreset}
          pickMode={pickMode === 'origin'}
          onPick={() => setPickMode(pickMode === 'origin' ? null : 'origin')}
        />
        <EndpointField
          title="Destination"
          value={goal}
          presetId={goalPreset}
          onPreset={onGoalPreset}
          pickMode={pickMode === 'goal'}
          onPick={() => setPickMode(pickMode === 'goal' ? null : 'goal')}
        />
      </div>

      <label className="block">
        <span className="input-label">Forecast horizon</span>
        <select
          className="select font-mono text-[12.5px]"
          value={timestep}
          onChange={(e) => setTimestep(Number(e.target.value))}
          disabled={!dates.length}
        >
          {!dates.length && <option value={0}>loading forecast calendar…</option>}
          {dates.map((d, i) => (
            <option key={d} value={i}>
              D+{i} · {d}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[10.5px] leading-snug text-steel">
          The SIC cost surface is the committed forecast field for exactly this day
          (<span className="font-mono">timestep 0…{Math.max(0, (metadata?.n_timesteps ?? 1) - 1)}</span>).
        </span>
      </label>

      <div>
        <span className="input-label">Route objective</span>
        <ObjectiveReadout weights={weights} loading={layersLoading} />
      </div>

      <Checkbox
        checked={snap}
        onChange={setSnap}
        label="Snap a non-navigable endpoint to the nearest navigable cell"
        hint="The API always reports any snap it performs (snapped, radius, requested)."
      />

      <div className="flex items-center gap-2">
        <Button onClick={onPlan} disabled={!canPlan || busy}>
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Navigation size={14} />}
          {busy ? 'Calculating…' : 'Plan route'}
        </Button>
        <span className="mono-label inline-flex items-center gap-1 text-steel">
          <MapPin size={11} /> POST /api/route/optimize
        </span>
      </div>

      {pickMode && (
        <p className="border border-ice/40 bg-ice/10 px-2.5 py-2 text-[11.5px] leading-snug text-ice">
          Click the map to set the {pickMode === 'origin' ? 'origin' : 'destination'}. The point must
          fall inside the served grid (−75…−32° lat, −10…82° lon) or the request is rejected.
        </p>
      )}

      {planError && (
        <p className="border border-danger/40 bg-danger/[0.07] px-2.5 py-2 text-[11.5px] leading-relaxed text-danger">
          {planError}
        </p>
      )}
    </FloatPanel>
  )
}
