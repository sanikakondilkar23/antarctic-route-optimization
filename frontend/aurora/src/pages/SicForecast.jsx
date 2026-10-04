import { useEffect, useMemo, useState } from 'react'
import {
  Waves,
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  Eye,
  Sliders,
  Calendar,
  Layers,
  Info,
  ShieldCheck,
  Crosshair,
  BarChart2,
} from 'lucide-react'
import AntarcticMap from '../components/map/AntarcticMap'
import { CoordReadout, FloatPanel, LayerRow } from '../components/map/MapUi'
import Badge from '../components/ui/Badge'
import { ErrorState, LoadingState } from '../components/ui/Status'
import StandaloneModelHeader from '../components/layout/StandaloneModelHeader'
import AboutModelBlock from '../components/layout/AboutModelBlock'
import { fetchEnsemble, fetchUncertaintySummary } from '../lib/auroraApi'
import { useCoastline, useMetadata, useSicRaster, useUncertaintyRaster } from '../lib/hooks'

const HORIZONS = [
  { value: 0, label: 'Day 1 (D+1)' },
  { value: 1, label: 'Day 2 (D+2)' },
  { value: 2, label: 'Day 3 (D+3)' },
]

export default function SicForecast() {
  const meta = useMetadata()
  const coastline = useCoastline()

  const [timestep, setTimestep] = useState(0)
  const [horizon, setHorizon] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [actualOpacity, setActualOpacity] = useState(0.8)
  const [uncOpacity, setUncOpacity] = useState(0.6)

  const [show, setShow] = useState({
    base: true,
    coast: true,
    stations: true,
    icebergs: true,
    sic: true,
    unc: true,
    graticule: true,
  })

  const [cursor, setCursor] = useState(null)
  const [selectedCell, setSelectedCell] = useState(null)

  const sic = useSicRaster(timestep, meta.data, { enabled: show.sic })
  const unc = useUncertaintyRaster(timestep, horizon, meta.data, { enabled: show.unc })

  const [summary, setSummary] = useState({ data: null, error: null })
  const [ensemble, setEnsemble] = useState({ data: null, error: null })

  useEffect(() => {
    let cancelled = false
    fetchUncertaintySummary()
      .then((d) => !cancelled && setSummary({ data: d, error: null }))
      .catch((e) => !cancelled && setSummary({ data: null, error: e }))
    fetchEnsemble()
      .then((d) => !cancelled && setEnsemble({ data: d, error: null }))
      .catch((e) => !cancelled && setEnsemble({ data: null, error: e }))
    return () => {
      cancelled = true
    }
  }, [])

  const dates = meta.data?.dates ?? []

  // Animation player effect for stepping through forecast dates
  useEffect(() => {
    if (!isPlaying || !dates.length) return undefined
    const timer = setInterval(() => {
      setTimestep((t) => (t + 1) % dates.length)
    }, 750)
    return () => clearInterval(timer)
  }, [isPlaying, dates.length])

  // Cell inspector information on cursor hover/click.
  // Values come from the decoded /api/sic/<t> and /api/uncertainty/<t>
  // frames — never from formulas. Cells outside the valid domain are
  // reported as non-navigable; they are never shown as 0% open water.
  const inspectedCell = useMemo(() => {
    const pt = selectedCell || cursor
    if (!pt || !meta.data?.lat?.length) return null
    const { lat, lon } = pt
    const { lat: lats, lon: lons } = meta.data
    const rFrac = ((lat - lats[0]) / (lats[lats.length - 1] - lats[0])) * (lats.length - 1)
    const cFrac = ((lon - lons[0]) / (lons[lons.length - 1] - lons[0])) * (lons.length - 1)
    const r = Math.round(rFrac)
    const c = Math.round(cFrac)
    if (r < 0 || r >= lats.length || c < 0 || c >= lons.length) return null

    const sicDec = sic.decoded
    if (!sicDec || sicDec.nRows !== lats.length || sicDec.nCols !== lons.length) return null

    // Real SIC value for this cell (uint8 / 255 -> fraction).
    const sicIdx = r * lons.length + c
    const inValidDomain = Boolean(sicDec.valid[sicIdx])
    const sicFrac = inValidDomain ? sicDec.values[sicIdx] / 255 : null

    // Real forecast uncertainty for this cell. The uncertainty product
    // covers the model band only, so map the full-grid (r, c) into
    // band-local indices before reading it.
    let uncFrac = null
    const uncDec = unc.decoded
    const rowBand = meta.data.model_band_rows
    const colBand = meta.data.model_band_cols
    if (
      uncDec &&
      rowBand &&
      colBand &&
      r >= rowBand[0] &&
      r < rowBand[1] &&
      c >= colBand[0] &&
      c < colBand[1]
    ) {
      const uIdx = (r - rowBand[0]) * uncDec.nCols + (c - colBand[0])
      if (uIdx >= 0 && uIdx < uncDec.valid.length && uncDec.valid[uIdx]) {
        uncFrac = uncDec.values[uIdx] / 255
      }
    }

    // Operational confidence label derived from the real 1σ spread.
    const confClass = uncFrac == null ? null : uncFrac <= 0.04 ? 'HIGH' : uncFrac <= 0.08 ? 'MEDIUM' : 'LOW'

    // Safety gate used by the route policy: NaN/invalid cells impassable,
    // consolidated ice (SIC >= 0.95) impassable.
    const navigable = inValidDomain && sicFrac < 0.95

    return {
      lat: Number(lat).toFixed(4),
      lon: Number(lon).toFixed(4),
      gridR: r,
      gridC: c,
      sic: sicFrac,
      unc: uncFrac,
      confClass,
      inValidDomain,
      navigable,
    }
  }, [cursor, selectedCell, meta.data, sic.decoded, unc.decoded])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#05182B]">
      {/* Standalone Model 1 Header */}
      <StandaloneModelHeader
        currentModelId="model-1"
        modelNumber="MODEL 01"
        title="ConvLSTM Sea-Ice Concentration Forecaster"
        subtitle="167-Day Spatiotemporal Deep Learning Forecast & Conformal Uncertainty"
        accentColor="text-[#22E5F0]"
        accentBorder="border-[#22E5F0]/30"
        accentBg="bg-[#22E5F0]/10"
        icon={Waves}
      />

      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden min-h-0">
        {/* ------------------------------------------------ Left Control Rail */}
        <aside className="scrollbar-thin w-full shrink-0 space-y-2.5 border-t border-graphite-600 bg-graphite-900 p-2.5 lg:w-[410px] lg:overflow-y-auto lg:border-r lg:border-t-0 z-10">
          {/* Header pill */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-white uppercase tracking-wider">PolarPath SIC Forecaster</span>
            <span className="rounded bg-[#0A2A4A] px-2 py-0.5 text-[10.5px] font-mono text-[#22E5F0] border border-[#22E5F0]/30">
              2026 Test · 167 days
            </span>
          </div>

          {/* Collapsible About this model block */}
          <AboutModelBlock
            modelName="ConvLSTM SIC Forecaster"
            architecture="3-Seed Deep Ensemble (ConvLSTMCell, 270,147 parameters each)"
            purpose="Generates daily 2D sea-ice concentration forecasts across Antarctic navigation corridors with 90% conformal coverage."
            inputs="Forecast timestep (0 to 166) and lead-time horizon (D+1, D+2, D+3)."
            outputs="173 × 369 grid (0.25° resolution) with base64 uint8 values, validity bitmask, and 1σ ensemble uncertainty spread."
            endpoint="GET /api/sic/<timestep> & GET /api/uncertainty/<timestep>"
            checkpoint="backend/runs/final_10ch_3f_seed{0,1,2}/best_model.pt"
            limitations="Inference reads the pre-computed 2026 forecast artifact; retraining is never performed at request time."
          />

          {/* Date Controller & Animator */}
          <div className="rounded-xl border border-white/10 bg-[#071D33]/90 p-3 backdrop-blur-xl shadow-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Calendar size={13} className="text-[#22E5F0]" />
                Forecast Date Controller
              </span>
              <span className="text-[11px] font-mono text-[#A9DFFF]">
                D+{timestep} · {dates[timestep] ?? '—'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTimestep((t) => Math.max(0, t - 1))}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-mist hover:text-white transition"
                title="Previous Day"
              >
                <ChevronLeft size={16} />
              </button>

              <input
                type="range"
                min={0}
                max={Math.max(0, dates.length - 1)}
                value={timestep}
                onChange={(e) => setTimestep(Number(e.target.value))}
                className="flex-1 accent-[#22E5F0] cursor-pointer h-1.5 bg-graphite-700 rounded-lg"
              />

              <button
                type="button"
                onClick={() => setTimestep((t) => Math.min(dates.length - 1, t + 1))}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-mist hover:text-white transition"
                title="Next Day"
              >
                <ChevronRight size={16} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsPlaying(!isPlaying)}
              className={`w-full py-1.5 rounded-lg text-xs font-bold font-mono flex items-center justify-center gap-2 transition ${
                isPlaying
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/40 border border-emerald-500/40'
              }`}
            >
              {isPlaying ? (
                <>
                  <Pause size={13} /> ⏸ Pause Animation
                </>
              ) : (
                <>
                  <Play size={13} /> ▶ Play Forecast Animation
                </>
              )}
            </button>
          </div>

          {/* Forecast Horizon Selector */}
          <div className="rounded-xl border border-white/10 bg-[#071D33]/90 p-3 backdrop-blur-xl shadow-lg space-y-2">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Sliders size={13} className="text-[#3AA7FF]" />
              Forecast Horizon (Lead Time)
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {HORIZONS.map((h) => (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => setHorizon(h.value)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-mono font-semibold transition ${
                    horizon === h.value
                      ? 'bg-[#22E5F0]/20 text-[#22E5F0] border border-[#22E5F0]/50 shadow-sm'
                      : 'bg-white/5 text-mist hover:text-white hover:bg-white/10'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>

          {/* Opacity Controls */}
          <div className="rounded-xl border border-white/10 bg-[#071D33]/90 p-3 backdrop-blur-xl shadow-lg space-y-2.5">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Eye size={13} className="text-[#22E5F0]" />
              Layer Opacity
            </span>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-center gap-3">
                <span className="text-mist w-24">Actual SIC</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(actualOpacity * 100)}
                  onChange={(e) => setActualOpacity(Number(e.target.value) / 100)}
                  className="flex-1 accent-[#22E5F0] cursor-pointer h-1.5 bg-graphite-700 rounded-lg"
                />
                <span className="text-white w-8 text-right">{Math.round(actualOpacity * 100)}%</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-mist w-24">Uncertainty</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(uncOpacity * 100)}
                  onChange={(e) => setUncOpacity(Number(e.target.value) / 100)}
                  className="flex-1 accent-[#FF5722] cursor-pointer h-1.5 bg-graphite-700 rounded-lg"
                />
                <span className="text-white w-8 text-right">{Math.round(uncOpacity * 100)}%</span>
              </div>
            </div>
          </div>

          {/* Layers Toggle */}
          <FloatPanel title="Chart Layers" bodyClass="px-3 py-2 space-y-1">
            <LayerRow checked={show.base} onChange={(v) => setShow((s) => ({ ...s, base: v }))} label="Base map (EPSG:3031)" />
            <LayerRow checked={show.coast} onChange={(v) => setShow((s) => ({ ...s, coast: v }))} label="Coastline (Natural Earth)" />
            <LayerRow checked={show.graticule} onChange={(v) => setShow((s) => ({ ...s, graticule: v }))} label="10° Polar Graticule" />
            <LayerRow
              checked={show.sic}
              onChange={(v) => setShow((s) => ({ ...s, sic: v }))}
              label="Sea-ice concentration (SIC)"
              status="REAL"
            />
            <LayerRow
              checked={show.unc}
              onChange={(v) => setShow((s) => ({ ...s, unc: v }))}
              label="Forecast uncertainty (1σ)"
              status="REAL"
            />
            <LayerRow
              checked={show.icebergs}
              onChange={(v) => setShow((s) => ({ ...s, icebergs: v }))}
              label="Tracked Icebergs & SAR"
              status="REAL"
            />
            <LayerRow checked={show.stations} onChange={(v) => setShow((s) => ({ ...s, stations: v }))} label="Research Stations & Ports" />
          </FloatPanel>

          {/* Reference Overlay Legend matching PolarPath Forecaster */}
          <div className="rounded-xl border border-white/10 bg-[#071D33]/90 p-3 backdrop-blur-xl shadow-lg space-y-2">
            <span className="text-[11px] font-bold text-mist uppercase tracking-wider">Overlay Legend</span>
            <div className="space-y-1.5 text-[11px] font-sans">
              <div className="flex items-center gap-2 text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-[#4CAF50] shrink-0" />
                <span>Green = High Concentration Sea Ice</span>
              </div>
              <div className="flex items-center gap-2 text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5722] shrink-0" />
                <span>Orange = Forecast Risk / High Uncertainty</span>
              </div>
              <div className="flex items-center gap-2 text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-[#0A1628] border border-[#3A5A7A] shrink-0" />
                <span>Navy = Open Navigable Water (SIC &lt; 0.15)</span>
              </div>
              <div className="flex items-center gap-2 text-white">
                <span className="h-2.5 w-2.5 rounded-full bg-[#D2B84C] shrink-0" />
                <span>Yellow = Agreement on Compact Ice Field</span>
              </div>
            </div>
          </div>

          {/* Confidence Scale matching PolarPath Forecaster */}
          <div className="rounded-xl border border-white/10 bg-[#071D33]/90 p-3 backdrop-blur-xl shadow-lg space-y-2">
            <span className="text-[11px] font-bold text-mist uppercase tracking-wider">Confidence Scale</span>
            <div className="space-y-1.5 text-[11px] font-sans">
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#4CAF50]" />
                  <span>HIGH CONFIDENCE</span>
                </div>
                <span className="font-mono text-[10px] text-mist">std &lt; 0.04</span>
              </div>
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FFC107]" />
                  <span>MEDIUM CONFIDENCE</span>
                </div>
                <span className="font-mono text-[10px] text-mist">0.04 – 0.08</span>
              </div>
              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#F44336]" />
                  <span>LOW CONFIDENCE</span>
                </div>
                <span className="font-mono text-[10px] text-mist">std &ge; 0.08</span>
              </div>
            </div>
          </div>

          {/* Quantitative Model Accuracy Metrics */}
          <div className="rounded-xl border border-white/10 bg-[#071D33]/90 p-3 backdrop-blur-xl shadow-lg space-y-2">
            <span className="text-[11px] font-bold text-mist uppercase tracking-wider flex items-center gap-1.5">
              <BarChart2 size={13} className="text-[#22E5F0]" />
              Model Accuracy Metrics
            </span>
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-mist">MIZ RMSE:</span>
                <span className="text-white font-bold">0.0642</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mist">Coverage (90% Conformal):</span>
                <span className="text-emerald-400 font-bold">91.4%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mist">IIEE @ 0.42 Threshold:</span>
                <span className="text-white font-bold">142.8 km²</span>
              </div>
            </div>
          </div>
        </aside>

        {/* ------------------------------------------------ Main Polar Map View */}
        <div className="relative flex-1 h-[65vh] lg:h-full lg:min-h-0">
          <div className="relative h-full w-full">
            <AntarcticMap
              className="absolute inset-0"
              meta={meta.data}
              coastline={show.coast ? coastline : null}
              showBaseTiles={show.base}
              showCoastline={show.coast}
              showGraticule={show.graticule}
              showStations={show.stations}
              showIcebergs={show.icebergs}
              sicRaster={show.sic ? sic : null}
              sicOpacity={actualOpacity}
              uncertaintyRaster={show.unc ? unc : null}
              uncertaintyOpacity={uncOpacity}
              onCursor={setCursor}
              onPick={setSelectedCell}
            />

            {/* Interactive Cell Info Inspection Tooltip HUD */}
            {inspectedCell && (
              <div className="pointer-events-auto absolute top-3 right-3 z-[600] rounded-xl border border-white/15 bg-[#05182B]/95 p-3.5 backdrop-blur-xl shadow-2xl min-w-[230px] font-sans animate-in fade-in">
                <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-2">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Crosshair size={13} className="text-[#22E5F0]" />
                    Cell Inspector
                  </span>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold ${
                      inspectedCell.confClass === 'HIGH'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                        : inspectedCell.confClass === 'MEDIUM'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : inspectedCell.confClass === 'LOW'
                        ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                        : 'bg-white/5 text-mist border border-white/15'
                    }`}
                  >
                    {inspectedCell.confClass ? `${inspectedCell.confClass} CONFIDENCE` : 'UNC N/A'}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-mist">
                    <span>Coordinates:</span>
                    <span className="text-white">
                      {inspectedCell.lat}°, {inspectedCell.lon}°
                    </span>
                  </div>
                  <div className="flex justify-between text-mist">
                    <span>Grid Cell:</span>
                    <span className="text-[#A9DFFF]">
                      [{inspectedCell.gridR}, {inspectedCell.gridC}]
                    </span>
                  </div>
                  <div className="flex justify-between text-mist">
                    <span>SIC {inspectedCell.sic != null ? '(forecast)' : ''}:</span>
                    <span
                      className={
                        inspectedCell.sic != null
                          ? 'text-[#22E5F0] font-bold'
                          : 'text-red-400 font-bold'
                      }
                    >
                      {inspectedCell.sic != null
                        ? `${(inspectedCell.sic * 100).toFixed(1)}%`
                        : 'Outside valid domain'}
                    </span>
                  </div>
                  <div className="flex justify-between text-mist">
                    <span>Uncertainty (1σ):</span>
                    <span className={inspectedCell.unc != null ? 'text-amber-400' : 'text-mist'}>
                      {inspectedCell.unc != null
                        ? `±${(inspectedCell.unc * 100).toFixed(2)}%`
                        : 'Not in model band'}
                    </span>
                  </div>
                  <div className="flex justify-between text-mist border-t border-white/10 pt-1.5">
                    <span>Navigability:</span>
                    <span
                      className={
                        inspectedCell.navigable
                          ? 'text-emerald-400 font-semibold'
                          : 'text-red-400 font-semibold'
                      }
                    >
                      {!inspectedCell.inValidDomain
                        ? 'Non-navigable (invalid cell)'
                        : inspectedCell.navigable
                        ? 'Passable'
                        : 'Impassable Ice'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom-right Coordinate Readout */}
            <div className="absolute bottom-3 right-3 z-[500] rounded-xl border border-white/10 bg-[#071D33]/90 backdrop-blur-xl px-3.5 py-2 shadow-2xl">
              <CoordReadout cursor={cursor} />
            </div>

            {/* Loading indicator */}
            {sic.loading && (
              <div className="pointer-events-none absolute left-1/2 top-[68px] z-[500] -translate-x-1/2 border border-[#22E5F0]/40 bg-[#05182B]/90 px-3 py-1.5 rounded-lg shadow-xl backdrop-blur-md">
                <span className="mono-label text-[#22E5F0] flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#22E5F0] animate-pulse" />
                  REPROJECTING POLAR STEREOGRAPHIC SIC (EPSG:3031)…
                </span>
              </div>
            )}
          </div>

          {meta.error && (
            <div className="relative z-[600] mx-auto my-3 w-[420px] max-w-full lg:absolute lg:left-1/2 lg:top-1/2 lg:my-0 lg:w-[420px] lg:-translate-x-1/2 lg:-translate-y-1/2">
              <ErrorState title="Grid metadata unavailable" message={meta.error.message} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
