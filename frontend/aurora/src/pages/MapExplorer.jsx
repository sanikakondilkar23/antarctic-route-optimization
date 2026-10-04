import { useState } from 'react'
import {
  Layers,
  MapPin,
  Ship,
  Snowflake,
  Route,
  Waves,
  Navigation,
  Wind,
  Compass,
  Eye,
  Sliders,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import AntarcticMap from '../components/map/AntarcticMap'
import SicLegend from '../components/sic/SicLegend'
import useSicForecast from '../hooks/useSicForecast'
import { cn } from '../lib/utils'

const CORRIDORS = [
  { id: 'Cape Town → Bharati Research Station', label: 'Cape Town → Bharati', center: [-58, 48], zoom: 4 },
  { id: 'Cape Town → Maitri Research Station', label: 'Cape Town → Maitri', center: [-56, 16], zoom: 4 },
  { id: 'Bharati Research Station → Maitri Research Station', label: 'Bharati ↔ Maitri', center: [-68, 44], zoom: 4 },
]

export default function MapExplorer() {
  const [activeCorridor, setActiveCorridor] = useState(CORRIDORS[0].id)
  const [mapCenter, setMapCenter] = useState([-60, 45])
  const [mapZoom, setMapZoom] = useState(3)

  const [layers, setLayers] = useState({
    vessels: true,
    icebergs: true,
    stations: true,
    routes: true,
    seaIce: true,
    wind: true,
    oceanCurrents: true,
    trajectories: true,
  })

  // Real sea-ice layer. `active.url` is null until the SIC API responds, in
  // which case AntarcticMap keeps drawing the original illustrative patches.
  const sic = useSicForecast()
  const sicRaster = sic.active?.available ? { url: sic.active.url, bounds: sic.active.bounds } : null

  const toggle = (key) => setLayers((l) => ({ ...l, [key]: !l[key] }))

  const selectCorridor = (corridor) => {
    setActiveCorridor(corridor.id)
    setMapCenter(corridor.center)
    setMapZoom(corridor.zoom)
  }

  const controls = [
    { key: 'vessels', label: 'Monitored Fleet', icon: Ship, color: 'bg-cyan' },
    { key: 'icebergs', label: 'Icebergs & Drift Vectors', icon: Snowflake, color: 'bg-ice' },
    { key: 'trajectories', label: 'Forecast Drift Cones', icon: Compass, color: 'bg-danger' },
    { key: 'stations', label: 'Research Stations', icon: MapPin, color: 'bg-safe' },
    { key: 'routes', label: 'Navigation Routes', icon: Route, color: 'bg-cyan' },
    { key: 'seaIce', label: 'Sea-Ice Concentration', icon: Waves, color: 'bg-ice-cyan' },
    { key: 'wind', label: 'Wind Field Vectors', icon: Wind, color: 'bg-warn' },
    { key: 'oceanCurrents', label: 'Ocean Currents (ACC & Coastal)', icon: Waves, color: 'bg-cyan' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Antarctic Map Explorer"
        subtitle="Operational theatre — multi-layer spatial picture combining research vessels, ice concentration, iceberg drift, wind, and ocean currents."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {sic.active?.available ? (
              <LiveChip label={`ConvLSTM SIC · ${sic.date}`} dot="safe" />
            ) : (
              <LiveChip label={sic.status === 'loading' ? 'Loading SIC' : 'SIC illustrative'} dot={sic.status === 'loading' ? 'warn' : 'danger'} />
            )}
            <LiveChip label="Other layers simulated" dot="cyan" />
            <button
              className="btn-secondary !px-3 !py-1.5 !text-xs"
              onClick={() => {
                setLayers({
                  vessels: true,
                  icebergs: true,
                  stations: true,
                  routes: true,
                  seaIce: true,
                  wind: true,
                  oceanCurrents: true,
                  trajectories: true,
                })
                setMapCenter([-60, 45])
                setMapZoom(3)
              }}
            >
              Reset view
            </button>
          </div>
        }
      />

      {/* Corridor Quick Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-navy-mid/60 p-3">
        <div className="flex items-center gap-2 text-xs text-mist">
          <Navigation size={14} className="text-cyan" />
          <span className="font-semibold text-white/90">Strategic Corridors:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {CORRIDORS.map((c) => (
            <button
              key={c.id}
              onClick={() => selectCorridor(c)}
              className={cn(
                'rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
                activeCorridor === c.id
                  ? 'border-cyan/50 bg-cyan/15 text-cyan shadow-glow'
                  : 'border-white/10 bg-white/5 text-mist hover:text-white'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        {/* Map Container */}
        <Card className="overflow-hidden relative">
          <Card.Header
            title="Interactive Antarctic Spatial Display"
            subtitle={`Focus: ${activeCorridor} · High-latitude maritime decision support`}
            icon={Navigation}
            action={
              <div className="flex items-center gap-2 text-xs font-mono text-cyan bg-cyan/10 px-2.5 py-1 rounded-lg border border-cyan/20">
                <Eye size={12} />
                {Object.values(layers).filter(Boolean).length} / {Object.keys(layers).length} Layers Active
              </div>
            }
          />
          <div className="p-3">
            <AntarcticMap
              center={mapCenter}
              zoom={mapZoom}
              height={660}
              layers={layers}
              activeCorridor={activeCorridor}
              sicRaster={sicRaster}
              className="!rounded-xl"
            />
          </div>
        </Card>

        {/* Control Sidebar */}
        <div className="space-y-4">
          <Card>
            <Card.Header title="Operational Layers" subtitle="Toggle spatial datasets" icon={Layers} />
            <Card.Body className="space-y-2">
              {controls.map((c) => (
                <label
                  key={c.key}
                  onClick={() => toggle(c.key)}
                  className="flex cursor-pointer items-center justify-between rounded-xl border border-white/5 bg-navy-deep/50 px-3.5 py-2.5 text-sm transition hover:border-white/15"
                >
                  <span className="flex items-center gap-2.5 font-medium text-white/85 text-xs">
                    <span className={cn('h-2 w-2 rounded-full shrink-0', c.color)} />
                    <c.icon size={14} className="text-mist shrink-0" />
                    <span className="truncate">{c.label}</span>
                  </span>
                  <span className={cn('relative h-4 w-8 shrink-0 rounded-full transition', layers[c.key] ? 'bg-cyan' : 'bg-white/10')}>
                    <span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', layers[c.key] ? 'left-[17px]' : 'left-0.5')} />
                  </span>
                </label>
              ))}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header title="Symbology Legend" icon={Sliders} />
            <Card.Body className="space-y-2 text-xs text-mist">
              {[
                ['Vessel (Fleet)', 'bg-cyan', 'Active AIS / GPS position'],
                ['Iceberg Marker', 'bg-ice', 'Tracked tabular iceberg'],
                ['Drift Cone', 'border border-danger border-dashed', 'Projected +24h/+48h drift path'],
                ['Wind Vector', 'text-warn font-bold', 'Wind barb / direction arrow (kn)'],
                ['Ocean Current', 'text-cyan font-bold', 'ACC & Coastal Current flow'],
                ['Research Station', 'bg-safe', 'Bharati, Maitri, Cape Town'],
              ].map(([label, dot, note]) => (
                <div key={label} className="flex items-center justify-between gap-2 border-b border-white/5 pb-1.5 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', dot)} />
                    <span className="font-semibold text-white/85 truncate">{label}</span>
                  </div>
                  <span className="truncate text-[10px] text-mist/70">{note}</span>
                </div>
              ))}

              {/* Sea-ice symbology comes from the SIC API, not from this file. */}
              <div className="border-t border-white/10 pt-2">
                <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-mist">
                  <Waves size={11} className="text-ice-cyan" />
                  Sea-Ice Concentration — ConvLSTM
                </p>
                {sic.status === 'loading' ? (
                  <p className="text-[10px] text-mist">Loading raster legend…</p>
                ) : sic.active?.available ? (
                  <>
                    <SicLegend legend={sic.active.legend} stats={sic.active.stats} />
                    <p className="mt-1.5 text-[10px] text-mist/70">
                      {sic.model?.architecture} · {sic.checkpointSummary?.loaded}/
                      {sic.checkpointSummary?.expected} checkpoints · {sic.date} · H+1
                    </p>
                  </>
                ) : (
                  <p className="text-[10px] leading-relaxed text-warn/90">
                    SIC API not reachable{sic.error ? `: ${sic.error.message}` : '.'} Falling back to
                    the illustrative patch layer, which is not model output.
                  </p>
                )}
              </div>
            </Card.Body>
          </Card>

          <Card>
            <Card.Header title="Stations & Ports" icon={MapPin} />
            <Card.Body className="space-y-2 text-xs text-mist">
              {[
                { name: 'Bharati Station', pos: '69.41°S, 76.20°E', loc: 'Larsemann Hills', type: 'Station' },
                { name: 'Maitri Station', pos: '70.77°S, 11.73°E', loc: 'Schirmacher Oasis', type: 'Station' },
                { name: 'Cape Town', pos: '33.92°S, 18.42°E', loc: 'South Africa', type: 'Staging Port' },
              ].map((s) => (
                <div key={s.name} className="rounded-xl bg-navy-deep/50 p-2.5 border border-white/5">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white/90">{s.name}</p>
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-safe/10 text-safe">{s.type}</span>
                  </div>
                  <p className="font-mono text-[11px] text-cyan mt-0.5">{s.pos}</p>
                  <p className="text-[10px] text-mist/70">{s.loc}</p>
                </div>
              ))}
            </Card.Body>
          </Card>
        </div>
      </div>
    </div>
  )
}