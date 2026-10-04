import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ChevronLeft,
  Ship,
  MapPin,
  Gauge,
  Navigation,
  Fuel,
  Clock,
  AlertTriangle,
  Route,
  Radar,
  History,
  Wind,
  Anchor,
  Users,
  Flag,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import AntarcticMap from '../components/map/AntarcticMap'
import { ChartCard, ChartTooltip } from '../components/charts'
import { EmptyState } from '../components/ui/Status'
import { Area, AreaChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import {
  ships,
  shipSpeedHistory,
  shipFuelConsumption,
  nearbyIcebergDistance,
  iceAlongRoute,
} from '../data'
import { fmtCoord } from '../lib/utils'

function DetailRow({ icon: Icon, label, value, tone = 'text-white' }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-navy-deep/50 px-4 py-3">
      <Icon size={16} className="mt-0.5 shrink-0 text-cyan" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wider text-mist">{label}</p>
        <p className={`truncate text-sm font-semibold ${tone}`}>{value}</p>
      </div>
    </div>
  )
}

function RiskBadge({ level }) {
  const tones = {
    Low: 'bg-safe/15 text-safe',
    Moderate: 'bg-warn/15 text-warn',
    High: 'bg-danger/15 text-danger',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${tones[level] ?? 'bg-white/5 text-mist'}`}>
      <AlertTriangle size={13} /> {level} risk
    </span>
  )
}

export default function ShipDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const ship = ships.find((s) => s.nameKey === id)

  if (!ship) {
    return (
      <EmptyState
        icon={Ship}
        title="Vessel not found"
        message="There is no vessel matching this identifier in the demo fleet."
        action={<Button onClick={() => navigate('/fleet')}>Back to fleet</Button>}
      />
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vessel Monitoring"
        subtitle={`${ship.name} · Fleet ID ${ship.id}`}
        actions={
          <>
            <Link to="/fleet" className="btn-ghost -ml-2">
              <ChevronLeft size={15} /> Fleet
            </Link>
            <Button variant="secondary" onClick={() => navigate('/route-planner')}><Route size={15} /> Plan Route</Button>
            <Button onClick={() => navigate('/alerts')}><Radar size={15} /> View Alerts</Button>
          </>
        }
      />

      {/* Status strip */}
      <div className="flex flex-wrap items-center gap-3">
        <Badge value={ship.status} />
        <RiskBadge level={ship.iceRisk} />
        <span className="chip"><Clock size={12} /> Last update · {ship.lastUpdate}</span>
        <span className="chip"><Flag size={12} /> {ship.flag}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Speed" value={`${ship.speed}`} subtitle="knots · simulated" icon={Gauge} tone="cyan" />
        <StatCard label="Heading" value={`${ship.heading}°`} subtitle="degrees true" icon={Navigation} tone="ocean" />
        <StatCard label="Fuel Level" value={`${ship.fuel}%`} subtitle={`Approx. range ${ship.fuelRange.toLocaleString()} km`} icon={Fuel} tone={ship.fuel < 40 ? 'warn' : 'safe'} />
        <StatCard label="Navigation Risk" value={ship.iceRisk} subtitle="Current ice exposure" icon={AlertTriangle} tone={ship.iceRisk === 'High' ? 'danger' : ship.iceRisk === 'Moderate' ? 'warn' : 'safe'} />
      </div>

      {/* Map + vessel facts */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <Card.Header title="Vessel Position & Route" subtitle="Simulated track toward destination" icon={Anchor} />
          <div className="p-3">
            <AntarcticMap height={440} highlightShip={ship} showRoutes className="!rounded-xl" />
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <Card>
            <Card.Header title="Current Position" icon={MapPin} />
            <Card.Body className="space-y-2.5">
              <DetailRow icon={MapPin} label="Coordinates" value={fmtCoord(ship.lat, ship.lon, 3)} />
              <DetailRow icon={Navigation} label="Destination" value={ship.destination} />
              <DetailRow icon={Clock} label="Estimated Arrival" value={ship.eta} />
              <DetailRow icon={Wind} label="Ice Risk" value={ship.iceRisk} tone={ship.iceRisk === 'High' ? 'text-danger' : ship.iceRisk === 'Moderate' ? 'text-warn' : 'text-safe'} />
            </Card.Body>
          </Card>
          <Card>
            <Card.Header title="Vessel Details" icon={Ship} />
            <Card.Body className="space-y-2.5">
              <DetailRow icon={Users} label="Crew Onboard" value={ship.crew} />
              <DetailRow icon={Flag} label="Flag / Registration" value={ship.flag} />
              <DetailRow icon={Route} label="Current Mission" value={ship.mission} />
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Speed over Time" subtitle="Simulated speed and running average (kn)" action={<Badge value="24 h" />}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={shipSpeedHistory} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="spd" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38BDF8" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#38BDF8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
              <XAxis dataKey="t" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} />
              <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} unit=" kn" />
              <Tooltip content={<ChartTooltip unit=" kn" />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Area type="monotone" dataKey="speed" name="Speed" stroke="#38BDF8" strokeWidth={2.5} fill="url(#spd)" />
              <Line type="monotone" dataKey="avg" name="Average" stroke="#7DD3FC" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Fuel Consumption" subtitle="Simulated daily consumption (tonnes)" action={<Badge value="8-day log" />}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={shipFuelConsumption} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="fuel" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34D399" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#34D399" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
              <XAxis dataKey="t" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} />
              <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} unit=" t" />
              <Tooltip content={<ChartTooltip unit=" t" />} />
              <Area type="monotone" dataKey="consumption" name="Consumption" stroke="#34D399" strokeWidth={2.5} fill="url(#fuel)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Nearby Iceberg Distance" subtitle="Distance to nearest tracked iceberg along route (km)" action={<Badge value="Closest: 21 km" />}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={nearbyIcebergDistance} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="near" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#F87171" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#F87171" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
              <XAxis dataKey="t" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} />
              <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} unit=" km" />
              <Tooltip content={<ChartTooltip unit=" km" />} />
              <Area type="monotone" dataKey="distance" name="Distance" stroke="#F87171" strokeWidth={2.5} fill="url(#near)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Sea-Ice Concentration Along Route" subtitle="Simulated ice fraction per route leg (%)" action={<Badge value="8 legs" />}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={iceAlongRoute} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="leg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
              <XAxis dataKey="t" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} />
              <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} unit="%" />
              <Tooltip content={<ChartTooltip unit="%" />} />
              <Area type="monotone" dataKey="concentration" name="Concentration" stroke="#22D3EE" strokeWidth={2.5} fill="url(#leg)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}