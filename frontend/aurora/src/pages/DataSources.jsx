import { useState } from 'react'
import {
  Satellite,
  Waves,
  Wind,
  Target,
  Database,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Search,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { EmptyState } from '../components/ui/Status'
import { dataSources, datasets } from '../data'
import { cn } from '../lib/utils'

const ICON_MAP = { Satellite, Waves, Wind, Target }

export default function DataSources() {
  const [active, setActive] = useState('All')
  const [search, setSearch] = useState('')

  const cats = ['All', ...dataSources.map((d) => d.category)]

  const filtered = datasets.filter(
    (d) =>
      (active === 'All' || d.category === active) &&
      (search.trim() === '' || d.name.toLowerCase().includes(search.toLowerCase()))
  )

  const categoryMeta = {
    'Satellite Data': { icon: Satellite, count: datasets.filter((d) => d.category === 'Satellite Data').length, tone: 'text-cyan bg-cyan/10' },
    'Oceanographic Data': { icon: Waves, count: datasets.filter((d) => d.category === 'Oceanographic Data').length, tone: 'text-ice bg-ocean/30' },
    'Meteorological Data': { icon: Wind, count: datasets.filter((d) => d.category === 'Meteorological Data').length, tone: 'text-ice bg-ice/10' },
    'Vessel Data': { icon: Target, count: datasets.filter((d) => d.category === 'Vessel Data').length, tone: 'text-safe bg-safe/10' },
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Sources"
        subtitle="The classes of data the platform is designed to consume. Availability below is illustrative of expected integrations."
        actions={<LiveChip label="Integration plan" dot="warn" />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dataSources.map((s) => {
          const Icon = ICON_MAP[s.icon]
          const meta = categoryMeta[s.category]
          return (
            <StatCard
              key={s.category}
              label={s.category}
              value={String(meta.count)}
              subtitle="Illustrative datasets in category"
              icon={Icon}
              tone={s.color}
              note={`${meta.count} source types`}
            />
          )
        })}
      </div>

      <Card className="overflow-hidden">
        <Card.Header
          title="Dataset Catalogue"
          subtitle="Illustrative descriptors for planned integrations"
          icon={Database}
          action={
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist/60" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search datasets…" className="input !w-56 !py-1.5 !pl-9 text-xs" />
            </div>
          }
        />
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {cats.map((c) => (
            <button
              key={c}
              onClick={() => setActive(c)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
                active === c ? 'border-cyan/40 bg-cyan/10 text-cyan' : 'border-white/10 bg-white/5 text-mist hover:text-white'
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={Database}
              title="No datasets match"
              message="Try a different search term or category."
              action={<button className="btn-secondary" onClick={() => { setSearch(''); setActive('All') }}>Clear filters</button>}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="th">Dataset</th>
                  <th className="th">Data type</th>
                  <th className="th">Update frequency</th>
                  <th className="th">Status</th>
                  <th className="th">Availability</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => (
                  <tr key={d.name} className="border-b border-white/5 last:border-0 hover:bg-white/2">
                    <td className="td">
                      <p className="font-semibold text-white">{d.name}</p>
                      <p className="mt-0.5 max-w-md text-[11px] text-mist">{d.provider}</p>
                    </td>
                    <td className="td text-xs">{d.type}</td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-white/80">
                        <Clock size={12} className="text-cyan" /> {d.update}
                      </span>
                    </td>
                    <td className="td"><Badge value={d.status} /></td>
                    <td className="td">
                      <span className={cn('inline-flex items-center gap-1.5 text-xs', d.availability === 'Variable' || d.availability === 'Moderate' ? 'text-warn' : 'text-safe')}>
                        {d.availability === 'Variable' || d.availability === 'Moderate' ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                        {d.availability}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border-t border-white/5 px-5 py-3">
          <p className="text-[11px] text-mist/70">
            Status labels reflect the planned integration posture of this prototype, not live feeds.
            No actual satellite, oceanographic, or ship data is being received in demo mode.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(categoryMeta).map(([cat, m]) => (
          <Card key={cat}>
            <Card.Body className="flex items-start gap-3">
              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', m.tone)}>
                <m.icon size={19} />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{cat}</p>
                <p className="mt-1 text-xs leading-relaxed text-mist">
                  {{
                    'Satellite Data': 'Passive microwave and SAR imagery feed ice concentration and iceberg detections.',
                    'Oceanographic Data': 'Currents, temperature and wave fields force drift and route models.',
                    'Meteorological Data': 'Wind and weather fields drive ice motion and transit conditions.',
                    'Vessel Data': 'Bridge telemetry keeps fleet position and fuel state current.',
                  }[cat]}
                </p>
              </div>
            </Card.Body>
          </Card>
        ))}
      </div>
    </div>
  )
}