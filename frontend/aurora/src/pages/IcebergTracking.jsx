import { useState } from 'react'
import {
  Snowflake,
  AlertTriangle,
  Database,
  Clock,
  Navigation,
  Radar,
  Ship,
  RefreshCw,
  ChevronRight,
  Radio,
  Check,
  TrendingUp,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import AntarcticMap from '../components/map/AntarcticMap'
import { CircleMarker, Polyline, Tooltip as MapTooltip } from 'react-leaflet'
import { ChartCard, ChartTooltip } from '../components/charts'
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { icebergs, icebergTrajectories } from '../data'
import { cn } from '../lib/utils'

export default function IcebergTracking() {
  const [selected, setSelected] = useState(icebergs[0])
  const [simulating, setSimulating] = useState(false)
  const [broadcastSent, setBroadcastSent] = useState(false)

  const nearRoute = icebergs.filter((b) => (b.risk === 'High' || b.risk === 'Critical') && b.distanceToRoute < 60)
  const highRisk = icebergs.filter((b) => b.risk === 'High' || b.risk === 'Critical')

  const traj = icebergTrajectories.find((t) => t.id === selected.id) || icebergTrajectories[0]
  const trajChart = (traj?.points ?? []).map((p, i) => ({
    week: p.t,
    lat: Math.abs(p.lat),
    lon: Math.abs(p.lon),
    speed: +(selected.speed * (0.85 + (i % 3) * 0.12)).toFixed(1),
  }))

  const simulate = () => {
    setSimulating(true)
    setTimeout(() => {
      setSimulating(false)
    }, 900)
  }

  const broadcastAlert = () => {
    setBroadcastSent(true)
    setTimeout(() => {
      setBroadcastSent(false)
    }, 3500)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Iceberg Intelligence & Trajectory Tracking"
        subtitle="Tracked iceberg catalogue with historical drift tracks, forward 24h/48h projected movement vectors, and fleet collision clearance analysis."
        actions={
          <div className="flex items-center gap-2">
            <LiveChip label="SAR + Model Fusion" dot="cyan" />
            <Button onClick={simulate} disabled={simulating} className="!px-4">
              <RefreshCw size={15} className={simulating ? 'animate-spin' : ''} />
              {simulating ? 'Ingesting SAR scenes…' : 'Simulate Sensor Pass'}
            </Button>
          </div>
        }
      />

      {broadcastSent && (
        <div className="flex items-center justify-between rounded-2xl border border-danger/40 bg-danger/10 px-5 py-3 text-danger shadow-glow">
          <div className="flex items-center gap-2.5">
            <Radio size={18} className="shrink-0 animate-pulse" />
            <span className="text-sm font-semibold">
              Proximity Alert Broadcasted: Warning advisory for {selected.id} dispatched to all active vessels in sector.
            </span>
          </div>
          <span className="text-xs font-mono opacity-80">{selected.distanceToRoute} km to corridor</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total Tracked Icebergs" value="128" subtitle="Objects in the regional catalogue" icon={Snowflake} tone="cyan" note="Illustrative" />
        <StatCard label="Near-Route Icebergs" value={String(nearRoute.length)} subtitle="Within 60 km of active corridors" icon={Radar} tone="warn" note="Illustrative" />
        <StatCard label="Critical / High Risk" value={String(highRisk.length)} subtitle="Elevated navigation hazard" icon={AlertTriangle} tone="danger" note="Illustrative" />
        <StatCard label="Last Synthetic Aperture Radar Pass" value="6 h ago" subtitle="SAR constellation coverage" icon={Database} tone="ocean" note="Demo feed" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        {/* Iceberg table */}
        <Card className="overflow-hidden">
          <Card.Header
            title="Iceberg Catalogue"
            subtitle="Select an object to inspect its motion vector, geometry, and trajectory history"
            icon={Snowflake}
            action={<span className="chip text-xs"><Clock size={12} /> Click row to focus</span>}
          />
          <div className="max-h-[460px] overflow-y-auto scrollbar-thin">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 bg-navy-mid">
                <tr>
                  <th className="th">Iceberg ID</th>
                  <th className="th">Position</th>
                  <th className="th">Drift</th>
                  <th className="th">Bearing</th>
                  <th className="th">Area</th>
                  <th className="th">Route Dist.</th>
                  <th className="th">Risk</th>
                </tr>
              </thead>
              <tbody>
                {icebergs.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setSelected(b)}
                    className={cn(
                      'cursor-pointer border-b border-white/5 last:border-0 transition',
                      selected.id === b.id ? 'bg-cyan/15 font-medium' : 'hover:bg-white/5'
                    )}
                  >
                    <td className="td font-mono font-bold text-cyan">{b.id}</td>
                    <td className="td font-mono text-xs">{b.lat.toFixed(2)}°S, {Math.abs(b.lon).toFixed(2)}°E</td>
                    <td className="td font-mono text-xs text-white/90">{b.speed} kn {b.direction}</td>
                    <td className="td font-mono text-xs text-mist">{b.bearingDeg || 0}°</td>
                    <td className="td font-mono text-xs">{b.areaKm2.toLocaleString()} km²</td>
                    <td className="td font-mono text-xs font-semibold text-white/90">{b.distanceToRoute} km</td>
                    <td className="td"><Badge value={b.risk} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-white/5 px-5 py-2.5 flex items-center justify-between text-[11px] text-mist/70">
            <span>Catalogue values are simulated demo fixtures for user evaluation.</span>
            <span className="font-mono text-cyan">Selected: {selected.id}</span>
          </div>
        </Card>

        {/* Details panel */}
        <div className="space-y-4">
          <Card>
            <Card.Header
              title={`${selected.id} — Characteristics`}
              subtitle="Drift kinematics and spatial envelope"
              icon={Radar}
              action={<Badge value={selected.risk} />}
            />
            <Card.Body className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  ['Current Coordinates', `${selected.lat.toFixed(2)}°S, ${Math.abs(selected.lon).toFixed(2)}°E`],
                  ['Drift Heading', `${selected.direction} (${selected.bearingDeg || 0}° True)`],
                  ['Drift Velocity', `${selected.speed} knots (~${(selected.speed * 1.852).toFixed(1)} km/h)`],
                  ['Surface Extent', `${selected.areaKm2.toLocaleString()} km²`],
                  ['Ice Shelf of Origin', selected.origin],
                  ['Route Separation', `${selected.distanceToRoute} km from corridor`],
                  ['Target Clearance', selected.distanceToRoute < 20 ? 'Critical Proximity' : selected.distanceToRoute < 50 ? 'Moderate Buffer' : 'Adequate Sea-Room'],
                  ['Last Observation', selected.lastObservation],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-xl border border-white/5 bg-navy-deep/50 p-2.5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-mist">{l}</p>
                    <p className="mt-0.5 text-xs font-semibold text-white truncate">{v}</p>
                  </div>
                ))}
              </div>

              {/* Forward Projection Card */}
              {selected.forecast24h && (
                <div className="rounded-xl border border-cyan/20 bg-cyan/5 p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between font-semibold text-cyan">
                    <span className="flex items-center gap-1.5"><TrendingUp size={13} /> Forward Drift Projections (AI Model)</span>
                    <span className="text-[10px] text-mist">Simulated</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-mist pt-1">
                    <div>
                      <span className="text-white/80 block font-medium">+24h Estimate:</span>
                      <span className="font-mono text-cyan">{selected.forecast24h.lat.toFixed(2)}°S, {Math.abs(selected.forecast24h.lon).toFixed(2)}°E</span>
                      <span className="block text-[10px] text-mist/60">Radius: ±{selected.forecast24h.uncertaintyKm} km</span>
                    </div>
                    <div>
                      <span className="text-white/80 block font-medium">+48h Estimate:</span>
                      <span className="font-mono text-danger">{selected.forecast48h.lat.toFixed(2)}°S, {Math.abs(selected.forecast48h.lon).toFixed(2)}°E</span>
                      <span className="block text-[10px] text-mist/60">Radius: ±{selected.forecast48h.uncertaintyKm} km</span>
                    </div>
                  </div>
                </div>
              )}

              <Button
                variant={selected.risk === 'Critical' || selected.risk === 'High' ? 'primary' : 'secondary'}
                className="w-full text-xs"
                onClick={broadcastAlert}
              >
                <Radio size={14} /> Broadcast Collision Hazard Warning
              </Button>
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Trajectory chart + map */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Drift Kinematics & Trajectory History"
          subtitle={`Simulated 8-week movement and drift speed for ${selected.id}`}
          action={<Badge value={selected.id} />}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trajChart} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
              <XAxis dataKey="week" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} />
              <YAxis yAxisId="speed" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} unit=" kn" />
              <Tooltip content={<ChartTooltip unit=" kn" />} />
              <Line
                yAxisId="speed"
                type="monotone"
                dataKey="speed"
                name="Drift Velocity"
                stroke="#38BDF8"
                strokeWidth={2.5}
                dot={{ r: 4, fill: '#38BDF8' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <Card className="overflow-hidden">
          <Card.Header
            title="Spatial Trajectory & Predicted Cone"
            subtitle="Simulated historical drift (cyan) and +24h / +48h forecasted path (red)"
            icon={Navigation}
            action={<span className="chip text-xs"><Ship size={12} className="text-cyan" /> Focused: {selected.id}</span>}
          />
          <div className="p-3">
            <div style={{ height: 320 }}>
              <AntarcticMap
                center={[selected.lat, selected.lon]}
                zoom={4}
                highlightIceberg={selected}
                layers={{ vessels: true, icebergs: true, stations: true, routes: false, seaIce: false, wind: false, oceanCurrents: false, trajectories: true }}
                className="!rounded-xl"
              >
                {/* Additional focused historical path */}
                {traj && (
                  <Polyline
                    positions={traj.points.map((p) => [p.lat, p.lon])}
                    pathOptions={{ color: '#22D3EE', weight: 3.5, dashArray: '5 6', opacity: 0.9 }}
                  />
                )}
                {/* Forecast path */}
                {traj?.forecast && (
                  <Polyline
                    positions={[
                      [traj.points[traj.points.length - 1].lat, traj.points[traj.points.length - 1].lon],
                      ...traj.forecast.map((f) => [f.lat, f.lon]),
                    ]}
                    pathOptions={{ color: '#F87171', weight: 3.5, dashArray: '3 4', opacity: 1 }}
                  />
                )}
                {traj?.points?.map((p, i) => (
                  <CircleMarker
                    key={`hist-${i}`}
                    center={[p.lat, p.lon]}
                    radius={i === 0 ? 3 : i === traj.points.length - 1 ? 6 : 4}
                    pathOptions={{
                      color: i === traj.points.length - 1 ? '#38BDF8' : '#22D3EE',
                      fillColor: i === traj.points.length - 1 ? '#38BDF8' : '#22D3EE',
                      fillOpacity: 0.9,
                      weight: 1.5,
                    }}
                  >
                    <MapTooltip>
                      <span className="text-xs">{i === 0 ? 'Origin — 8 weeks ago' : i === traj.points.length - 1 ? `${selected.id} · Current Position` : p.t}</span>
                    </MapTooltip>
                  </CircleMarker>
                ))}
                {traj?.forecast?.map((f, fi) => (
                  <CircleMarker
                    key={`fc-${fi}`}
                    center={[f.lat, f.lon]}
                    radius={fi === 0 ? 6 : 8}
                    pathOptions={{ color: '#F87171', fillColor: '#F87171', fillOpacity: 0.9, weight: 2 }}
                  >
                    <MapTooltip>
                      <span className="text-xs">{selected.id} Projected Position: {f.t}</span>
                    </MapTooltip>
                  </CircleMarker>
                ))}
              </AntarcticMap>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 px-1 text-[11px] text-mist">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-cyan inline-block" /> 8-week historical drift</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-danger inline-block border-dashed" /> 24h & 48h forecast cone</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan inline-block" /> Current position</span>
              <span className="ml-auto font-mono text-cyan font-bold">{selected.id} · {selected.speed} kn @ {selected.bearingDeg || 0}°</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}