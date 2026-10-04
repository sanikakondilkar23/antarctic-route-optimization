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
    <div className="rounded-xl border border-white/10 bg-[#05182B]/70 p-3 shadow-inner">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#A9DFFF] font-semibold">{title}</span>
        <span className={cn('text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border', pickMode ? 'bg-[#22E5F0]/20 border-[#22E5F0]/40 text-[#22E5F0] animate-pulse' : isCustom ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'bg-white/5 border-white/10 text-mist')}>
          {pickMode ? 'PICKING ON MAP' : isCustom ? 'CUSTOM POINT' : 'PRESET'}
        </span>
      </div>

      <select
        className="select rounded-lg bg-[#071D33] border border-white/15 text-[12.5px] text-white focus:border-[#22E5F0] focus:ring-1 focus:ring-[#22E5F0]"
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

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[11.5px] text-[#EAF6FF]">
          {Number(value.lat).toFixed(4)}°, {Number(value.lon).toFixed(4)}°
        </span>
        <button
          type="button"
          onClick={onPick}
          className={cn(
            'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition',
            pickMode
              ? 'border-[#22E5F0]/60 bg-[#22E5F0]/20 text-[#22E5F0] shadow-[0_0_10px_rgba(34,229,240,0.3)]'
              : 'border-white/10 bg-white/5 text-mist hover:text-white hover:bg-white/10'
          )}
        >
          {pickMode ? <X size={12} /> : <Crosshair size={12} className="text-[#22E5F0]" />}
          {pickMode ? 'Cancel' : 'Pick on map'}
        </button>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-[#FF4D5E] font-medium">{error}</p>}
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

      <div className="pt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onPlan}
          disabled={!canPlan || busy}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#22E5F0] to-[#3AA7FF] px-4 py-2.5 text-xs font-bold text-[#05182B] shadow-[0_0_20px_rgba(34,229,240,0.35)] transition-all duration-300 hover:shadow-[0_0_28px_rgba(34,229,240,0.55)] hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <RefreshCw size={14} className="animate-spin text-[#05182B]" /> : <Navigation size={14} className="text-[#05182B]" />}
          <span>{busy ? 'Calculating Optimal Route…' : 'Plan Route'}</span>
        </button>
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-mist/70 pt-1">
        <span>A* Safety Authority Gate</span>
        <span className="text-[#A9DFFF]">POST /api/route/optimize</span>
      </div>

      {pickMode && (
        <p className="rounded-xl border border-[#22E5F0]/40 bg-[#22E5F0]/10 px-3 py-2 text-[11.5px] leading-snug text-[#22E5F0]">
          Click the map to set the {pickMode === 'origin' ? 'origin' : 'destination'}. The point must
          fall inside the served grid (−75…−32° lat, −10…82° lon) or the request is rejected.
        </p>
      )}

      {planError && (
        <div className="rounded-xl border border-[#FF4D5E]/40 bg-[#FF4D5E]/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-[#FF4D5E]">
          <span className="font-semibold block mb-0.5">Route Generation Error:</span>
          {planError}
        </div>
      )}
    </FloatPanel>
  )
}
