import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Ship,
  ArrowRight,
  Navigation,
  Fuel,
  Wind,
  ShieldAlert,
  Gauge,
  MapPin,
  Clock,
  Filter,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Badge from '../components/ui/Badge'
import Card from '../components/ui/Card'
import { EmptyState } from '../components/ui/Status'
import { ships } from '../data'
import { fmtCoord, cn } from '../lib/utils'

const STATUS_FILTERS = ['All', 'En Route', 'Monitoring', 'At Station', 'Alert']

function RiskBadge({ level }) {
  const tones = {
    Low: 'text-safe bg-safe/10',
    Moderate: 'text-warn bg-warn/10',
    High: 'text-danger bg-danger/10',
  }
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', tones[level])}>
      <ShieldAlert size={12} /> {level}
    </span>
  )
}

export default function Fleet() {
  const [filter, setFilter] = useState('All')

  const filtered = filter === 'All' ? ships : ships.filter((s) => s.status === filter)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet"
        subtitle="All monitored research vessels with live (simulated) position and condition."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Filter size={14} className="text-mist" />
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
                  filter === f ? 'border-cyan/40 bg-cyan/10 text-cyan' : 'border-white/10 bg-white/5 text-mist hover:text-white'
                )}
              >
                {f}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Total Vessels" value="04" subtitle="In the active Antarctic fleet" icon={Ship} tone="cyan" note="Demo" />
        <StatCard label="Currently En Route" value="02" subtitle="Proceeding to research stations" icon={Navigation} tone="ocean" note="Demo" />
        <StatCard label="Require Attention" value="01" subtitle="Vessel on alert status" icon={ShieldAlert} tone="danger" note="Demo" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Ship}
          title="No vessels in this state"
          message="Try another status filter — all demo vessels currently hold En Route, Monitoring, At Station or Alert states."
          action={
            <button onClick={() => setFilter('All')} className="btn-secondary">Show all vessels</button>
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-2">
          {filtered.map((ship) => (
            <Link key={ship.id} to={`/fleet/${ship.nameKey}`} className="group">
              <Card className="card-hover h-full">
                <Card.Body className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-cyan/25 to-ocean/20 text-cyan ring-1 ring-cyan/20">
                        <Ship size={22} />
                      </div>
                      <div>
                        <p className="text-[15px] font-bold text-white group-hover:text-cyan">{ship.name}</p>
                        <p className="font-mono text-[11px] text-mist">ID · {ship.id}</p>
                      </div>
                    </div>
                    <Badge value={ship.status} />
                  </div>

                  <div className="flex items-center gap-2 rounded-xl border border-white/5 bg-navy-deep/50 px-3.5 py-2.5 text-xs text-mist">
                    <MapPin size={13} className="shrink-0 text-cyan" />
                    <span>{fmtCoord(ship.lat, ship.lon)}</span>
                    <span className="mx-1 text-white/15">|</span>
                    <span>{ship.destination}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { icon: Gauge, label: 'Speed', value: `${ship.speed} kn` },
                      { icon: Navigation, label: 'Heading', value: `${ship.heading}°` },
                      { icon: Fuel, label: 'Fuel', value: `${ship.fuel}%` },
                      { icon: Wind, label: 'Ice risk', value: ship.iceRisk, risk: true },
                    ].map((m) => (
                      <div key={m.label} className="rounded-xl border border-white/5 bg-white/2 p-3">
                        <m.icon size={14} className="text-mist" />
                        <p className="mt-1.5 text-sm font-semibold text-white">{m.value}</p>
                        <p className="text-[10px] uppercase tracking-wider text-mist">{m.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-white/5 pt-3">
                    <div className="flex items-center gap-2 text-[11px] text-mist">
                      <Clock size={12} className="text-cyan" />
                      Last update · {ship.lastUpdate}
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan">
                      View vessel <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Card.Body>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}