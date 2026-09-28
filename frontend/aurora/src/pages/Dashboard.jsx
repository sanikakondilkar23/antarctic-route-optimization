import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ship,
  Snowflake,
  AlertTriangle,
  RefreshCw,
  Clock,
  Compass,
  Waves,
  Radar,
  Route,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  Activity,
  Wind,
  Layers,
  ChevronRight,
  Check,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import AntarcticMap from '../components/map/AntarcticMap'
import { ChartCard, ChartTooltip } from '../components/charts'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import useSicForecast from '../hooks/useSicForecast'
import {
  fleetStatusRows,
  recentActivity,
  nearbyIcebergDistance,
  fmtTimestamp,
} from '../data'
import { cn } from '../lib/utils'

const LIVE_ALERTS_FEED = [
  { id: 'ALT-101', tone: 'danger', title: 'Iceberg cluster near Bharati corridor', detail: 'A-76A fragment within 12 NM · Immediate heading review advised', time: '14m ago', status: 'Active' },
  { id: 'ALT-102', tone: 'warn', title: 'Sea-ice concentration threshold breach', detail: 'Prydz Bay coastal approach entering Close Pack (78%)', time: '38m ago', status: 'Active' },
  { id: 'ALT-103', tone: 'mint', title: 'ACC Current velocity acceleration', detail: 'Circumpolar jet at 0.9 kn ENE favoring eastbound transit', time: '2h ago', status: 'Monitored' },
]

export default function Dashboard() {
  const [updating, setUpdating] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(fmtTimestamp())
  const [activeCorridor, setActiveCorridor] = useState('cape-town-to-bharati')
  const [alertsState, setAlertsState] = useState(LIVE_ALERTS_FEED)
  const [toast, setToast] = useState(null)

  // Real sea-ice layer from the SIC API. Null while loading or on error, in
  // which case AntarcticMap keeps the original illustrative patches.
  const sic = useSicForecast()
  const sicRaster = sic.active?.available ? { url: sic.active.url, bounds: sic.active.bounds } : null
  const sicMeanPct =
    sic.active?.stats?.kind === 'sic' ? `${(sic.active.stats.mean * 100).toFixed(1)}%` : null
  const sicSeries = (sic.timeseries?.series ?? []).map((r) => ({
    t: r.date?.slice(5) ?? '',
    concentration: typeof r.forecast === 'number' ? r.forecast * 100 : null,
  }))

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const refresh = () => {
    setUpdating(true)
    setTimeout(() => {
      setLastUpdate(fmtTimestamp())
      setUpdating(false)
      showToast('Polar sensor telemetry refreshed from simulated stations')
    }, 800)
  }

  const handleAck = (id) => {
    setAlertsState((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'Acknowledged', tone: 'mint' } : a))
    )
    showToast(`Alert ${id} acknowledged by Bridge Watchstander`)
  }

  return (
    <div className="space-y-6">
      {/* Cockpit Command Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-mint animate-ping" />
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-mint">
              POLAR BRIDGE COMMAND COCKPIT
            </span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Antarctic Tactical Operations
          </h1>
          <p className="mt-0.5 text-xs text-mist">
            AI-Assisted Corridor Monitoring · Southern Ocean Sector (50°S–75°S) · Demo Environment
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-abyssal-deck px-3.5 py-1.5 font-mono text-xs text-mist">
            <Clock size={13} className="text-mint" />
            <span>Sync: <strong className="text-white">{lastUpdate}</strong></span>
          </div>
          <Button onClick={refresh} disabled={updating} className="!py-1.5 !px-3.5 !text-xs font-bold">
            <RefreshCw size={13} className={updating ? 'animate-spin' : ''} />
            {updating ? 'Ingesting…' : 'Ingest Feeds'}
          </Button>
        </div>
      </div>

      {toast && (
        <div className="flex items-center justify-between rounded-xl border border-mint/40 bg-abyssal-card/95 px-4 py-2.5 text-xs text-mint shadow-glow">
          <span className="font-semibold">{toast}</span>
          <button onClick={() => setToast(null)} className="text-mist hover:text-white">✕</button>
        </div>
      )}

      {/* NEW FEATURE: Expedition Corridor Progress Strip */}
      <div className="rounded-2xl border border-white/10 bg-abyssal-card/90 p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Compass size={16} className="text-mint" />
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              Active Expedition Transit Corridors
            </span>
          </div>
          <span className="font-mono text-[11px] text-mist">
            Cape Town ➔ Bharati & Maitri Research Stations
          </span>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Corridor 1: Bharati */}
          <div
            onClick={() => setActiveCorridor('cape-town-to-bharati')}
            className={cn(
              'cursor-pointer rounded-xl border p-3.5 transition-all',
              activeCorridor === 'cape-town-to-bharati'
                ? 'border-mint/50 bg-mint/5 shadow-sm'
                : 'border-white/5 bg-abyssal/50 hover:border-white/20'
            )}
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-mint" />
                <span className="font-bold text-white">Cape Town ➔ Bharati Station</span>
              </div>
              <span className="font-mono text-[11px] font-bold text-mint">52% NAVIGATED</span>
            </div>

            {/* Progress bar with vessel pip */}
            <div className="relative mt-2.5 h-2 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-azure to-mint rounded-full" style={{ width: '52%' }} />
            </div>

            <div className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-mist">
              <span>Navigated: <strong>2,818 / 5,420 km</strong></span>
              <span>ETA: <strong>6.2 Days</strong></span>
              <span className="text-azure">RV Bharati Explorer</span>
            </div>
          </div>

          {/* Corridor 2: Maitri */}
          <div
            onClick={() => setActiveCorridor('cape-town-to-maitri')}
            className={cn(
              'cursor-pointer rounded-xl border p-3.5 transition-all',
              activeCorridor === 'cape-town-to-maitri'
                ? 'border-mint/50 bg-mint/5 shadow-sm'
                : 'border-white/5 bg-abyssal/50 hover:border-white/20'
            )}
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-azure" />
                <span className="font-bold text-white">Cape Town ➔ Maitri Station</span>
              </div>
              <span className="font-mono text-[11px] font-bold text-azure">68% NAVIGATED</span>
            </div>

            {/* Progress bar */}
            <div className="relative mt-2.5 h-2 w-full rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-azure-deep to-azure rounded-full" style={{ width: '68%' }} />
            </div>

            <div className="mt-2.5 flex items-center justify-between font-mono text-[11px] text-mist">
              <span>Navigated: <strong>2,896 / 4,260 km</strong></span>
              <span>ETA: <strong>3.1 Days</strong></span>
              <span className="text-azure">RV Maitri Voyager</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Tactical Cockpit Grid */}
      <div className="grid gap-5 xl:grid-cols-12">
        {/* Left/Center: Tactical Theatre Polar Map (8 cols) */}
        <div className="xl:col-span-8">
          <Card className="card-tactical overflow-hidden h-full flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3.5 bg-abyssal-deck/70">
              <div className="flex items-center gap-2.5">
                <Compass size={18} className="text-mint" />
                <div>
                  <h3 className="text-sm font-bold text-white">Tactical Polar Theatre</h3>
                  <p className="text-[11px] font-mono text-mist">
                    Active Corridor: {activeCorridor === 'cape-town-to-bharati' ? 'Cape Town ➔ Bharati Station' : 'Cape Town ➔ Maitri Station'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  to="/map"
                  className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/10 hover:border-mint/30 transition"
                >
                  <Layers size={13} className="text-mint" /> Full Explorer
                </Link>
                <Link
                  to="/route-planner"
                  className="inline-flex items-center gap-1 rounded-lg border border-mint/30 bg-mint/10 px-2.5 py-1 text-xs font-bold text-mint hover:bg-mint/20 transition"
                >
                  <Route size={13} /> Route Engine
                </Link>
              </div>
            </div>

            {/* Tactical Map with floating HUD badges */}
            <div className="relative flex-1 p-3">
              {/* Floating on-map HUD bar */}
              <div className="pointer-events-none absolute top-5 left-5 z-[500] flex flex-wrap gap-2">
                <span className="rounded-lg border border-white/15 bg-abyssal-deck/90 px-2.5 py-1 font-mono text-[10px] font-bold text-white shadow-lg backdrop-blur">
                  LAT/LON: 62°14'S, 58°40'E
                </span>
                <span className="rounded-lg border border-mint/30 bg-abyssal-deck/90 px-2.5 py-1 font-mono text-[10px] font-bold text-mint shadow-lg backdrop-blur">
                  {sicMeanPct ? `SIC ${sicMeanPct} (MODEL)` : 'SIC: N/A'}
                </span>
                <span className="rounded-lg border border-warn/30 bg-abyssal-deck/90 px-2.5 py-1 font-mono text-[10px] font-bold text-warn shadow-lg backdrop-blur">
                  WIND: 32 kn SSW
                </span>
              </div>

              <AntarcticMap height={480} activeCorridor={activeCorridor} sicRaster={sicRaster} className="!rounded-xl border border-white/10" />

              {/* Map Legend & Symbology Bar */}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono text-mist">
                <div className="flex flex-wrap items-center gap-4">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-mint" /> Research Vessel</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-danger" /> Tabular Iceberg</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-3 bg-azure" /> Safe Corridor</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warn" /> Wind Barb</span>
                </div>
                <span className="text-[10px] text-mist/60">Cartographic Datum: WGS-84 Polar</span>
              </div>
            </div>
          </Card>
        </div>

        {/* Right: AI Hazard & Risk Matrix Panel (4 cols) */}
        <div className="xl:col-span-4 flex flex-col gap-4">
          <Card className="card-tactical flex-1">
            <Card.Header
              title="Hazard & Risk Matrix"
              subtitle="Real-time proximity warnings"
              icon={Radar}
              action={<span className="rounded-full bg-danger/20 border border-danger/40 px-2 py-0.5 font-mono text-[10px] font-bold text-danger">3 ACTIVE</span>}
            />
            <Card.Body className="space-y-3">
              {alertsState.map((a) => (
                <div
                  key={a.id}
                  className={cn(
                    'rounded-xl border p-3 transition-all',
                    a.status === 'Acknowledged'
                      ? 'border-white/5 bg-white/2 opacity-70'
                      : a.tone === 'danger'
                      ? 'border-danger/30 bg-danger/5 hover:border-danger/50'
                      : a.tone === 'warn'
                      ? 'border-warn/30 bg-warn/5 hover:border-warn/50'
                      : 'border-mint/30 bg-mint/5 hover:border-mint/50'
                  )}
                >
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', a.tone === 'danger' ? 'bg-danger' : a.tone === 'warn' ? 'bg-warn' : 'bg-mint')} />
                      <span className="font-bold text-white">{a.title}</span>
                    </div>
                    <span className="font-mono text-[10px] text-mist shrink-0">{a.time}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-mist leading-relaxed">{a.detail}</p>
                  <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2">
                    <span className="font-mono text-[10px] text-mist/70">{a.id}</span>
                    {a.status === 'Active' ? (
                      <button
                        onClick={() => handleAck(a.id)}
                        className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-bold text-white hover:bg-mint hover:text-abyssal transition"
                      >
                        <Check size={11} /> Acknowledge
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-mint">
                        <CheckCircle2 size={11} /> Acknowledged
                      </span>
                    )}
                  </div>
                </div>
              ))}

              <Link to="/alerts" className="block pt-1">
                <Button variant="secondary" className="w-full !py-2 !text-xs">
                  Full Hazard Radar <ArrowUpRight size={13} />
                </Button>
              </Link>
            </Card.Body>
          </Card>

          {/* Iceberg Proximity Radar Tile */}
          <Card className="card-tactical p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Snowflake size={16} className="text-azure" />
                <span className="text-xs font-bold uppercase text-white">Nearest Tracked Berg</span>
              </div>
              <span className="font-mono text-[11px] font-bold text-danger">14.2 NM Ahead</span>
            </div>
            <p className="mt-1.5 text-xs text-mist">
              Tabular A-76A fragment drifting at 1.8 kn toward northeast corridor boundary.
            </p>
            <div className="mt-3 flex items-center justify-between font-mono text-[11px] border-t border-white/5 pt-2">
              <span className="text-mist">Drift Vector: 038° (NE)</span>
              <span className="text-mint">Collision Cone Clear</span>
            </div>
          </Card>
        </div>
      </div>

      {/* 4 Instrument Metrics Tiles */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tracked Vessels"
          value="04"
          subtitle="4 Active research expeditions"
          icon={Ship}
          tone="cyan"
          note="FLEET_ONLINE"
        />
        <StatCard
          label="Icebergs Monitored"
          value="128"
          subtitle="Tabular & pinnacled targets"
          icon={Snowflake}
          tone="ice"
          note="SAR_RADAR"
        />
        <StatCard
          label="Corridor Efficiency"
          value="91.4%"
          subtitle="Fuel & distance optimization score"
          icon={Activity}
          tone="safe"
          trend="+3.2%"
          note="AI_SCORE"
        />
        <StatCard
          label="Hazard Alerts"
          value="03"
          subtitle="Proximity & pack threshold flags"
          icon={AlertTriangle}
          tone="warn"
          note="ATTN_REQ"
        />
      </div>

      {/* Charts & Fleet Telemetry Grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          title="Sea-Ice Concentration — ConvLSTM Forecast"
          subtitle={
            sic.status === 'ready'
              ? `Day-1 ensemble mean over the model ROI · ${sicSeries.length} days · real model output`
              : sic.status === 'error'
                ? 'SIC API unavailable — no model data shown'
                : 'Waiting for the SIC API'
          }
          action={
            <span className="font-mono text-xs text-mint">
              {sic.status === 'ready' ? 'Model ROI' : '—'}
            </span>
          }
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sicSeries} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="mintGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00F2C3" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#00F2C3" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke="rgba(255,255,255,0.2)" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={28} />
              <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: '#94a3b8', fontSize: 11 }} unit="%" />
              <Tooltip content={<ChartTooltip unit="%" />} />
              <Area type="monotone" dataKey="concentration" name="Sea-Ice Concentration" stroke="#00F2C3" strokeWidth={2.5} fill="url(#mintGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Nearest Iceberg Distance"
          subtitle="Simulated distance to closest tracked hazard along corridor (km)"
          action={<span className="font-mono text-xs text-azure">Berg A-76A</span>}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={nearbyIcebergDistance} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="azureGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
              <XAxis dataKey="t" stroke="rgba(255,255,255,0.2)" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis stroke="rgba(255,255,255,0.2)" tick={{ fill: '#94a3b8', fontSize: 11 }} unit=" km" />
              <Tooltip content={<ChartTooltip unit=" km" />} />
              <Area type="monotone" dataKey="distance" name="Iceberg Distance" stroke="#38BDF8" strokeWidth={2.5} fill="url(#azureGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Fleet Telemetry Table */}
      <Card className="card-tactical overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 bg-abyssal-deck/70">
          <div className="flex items-center gap-2.5">
            <Ship size={18} className="text-mint" />
            <div>
              <h3 className="text-sm font-bold text-white">Fleet Telemetry & Status</h3>
              <p className="text-[11px] text-mist">Live vessel positions, headings, and ice exposure</p>
            </div>
          </div>
          <Link to="/fleet" className="inline-flex items-center gap-1 font-mono text-xs font-bold text-mint hover:underline">
            Manage Fleet Roster <ChevronRight size={13} />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10 bg-abyssal/40">
                <th className="th">Vessel Name</th>
                <th className="th">Current Sector</th>
                <th className="th">Mission Status</th>
                <th className="th">Speed</th>
                <th className="th hidden sm:table-cell">Winds</th>
                <th className="th text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {fleetStatusRows.map((v) => (
                <tr key={v.name} className="border-b border-white/5 last:border-0 hover:bg-white/2 transition">
                  <td className="td">
                    <p className="font-bold text-white">{v.name}</p>
                    <p className="font-mono text-[10px] text-mist">IMO 982103 · Polar Class 4</p>
                  </td>
                  <td className="td font-mono">{v.sector}</td>
                  <td className="td"><Badge value={v.status} /></td>
                  <td className="td font-mono font-bold text-mint">{v.speed}</td>
                  <td className="td hidden font-mono text-mist sm:table-cell">{v.winds}</td>
                  <td className="td text-right">
                    <Link
                      to="/fleet"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white hover:bg-mint hover:text-abyssal transition"
                    >
                      Track <ArrowUpRight size={11} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}