import { useState } from 'react'
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  Filter,
  MapPin,
  Clock,
  Snowflake,
  Waves,
  Wind,
  Route,
  Database,
  CheckCircle2,
  Check,
  RotateCcw,
  BellPlus,
  Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { EmptyState } from '../components/ui/Status'
import { alerts as seedAlerts } from '../data'
import { cn } from '../lib/utils'

const CATEGORY_ICONS = {
  'Iceberg Alert': Snowflake,
  'Sea-Ice Alert': Waves,
  'Weather Alert': Wind,
  'Route Deviation': Route,
  'Data Quality Alert': Database,
}

const CATEGORY_TONES = {
  'Iceberg Alert': 'text-ice bg-ice/10',
  'Sea-Ice Alert': 'text-cyan bg-cyan/10',
  'Weather Alert': 'text-warn bg-warn/10',
  'Route Deviation': 'text-danger bg-danger/10',
  'Data Quality Alert': 'text-mist bg-white/5',
}

const SEVERITY_ICONS = {
  Critical: AlertTriangle,
  Warning: AlertCircle,
  Information: Info,
}

const SEVERITY_TONES = {
  Critical: 'text-danger',
  Warning: 'text-warn',
  Information: 'text-cyan',
}

const SEVERITY_FILTERS = ['All', 'Critical', 'Warning', 'Information']
const STATUS_FILTERS = ['All', 'Active', 'Monitoring', 'Resolved']

export default function Alerts() {
  const [items, setItems] = useState(seedAlerts)
  const [severityFilter, setSeverityFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [toastMessage, setToastMessage] = useState(null)

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3000)
  }

  const handleStatusChange = (id, newStatus) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: newStatus } : item))
    )
    showToast(`Alert ${id} updated to ${newStatus}`)
  }

  const handleDismiss = (id) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
    showToast(`Alert ${id} dismissed`)
  }

  const handleAcknowledgeAll = () => {
    setItems((prev) =>
      prev.map((item) => (item.status === 'Active' ? { ...item, status: 'Monitoring' } : item))
    )
    showToast('All active alerts moved to Monitoring')
  }

  const handleSimulateAlert = () => {
    const newId = `ALT-${Math.floor(1000 + Math.random() * 9000)}`
    const newAlert = {
      id: newId,
      severity: 'Critical',
      category: 'Iceberg Alert',
      title: 'Sudden Ice Drift on Maitri Corridor',
      description: 'Simulated high-drift tabular iceberg cluster detected 14 NM ahead of track. Immediate heading adjustment recommended.',
      location: '65°14\'S, 14°40\'E',
      time: 'Just now',
      status: 'Active',
    }
    setItems((prev) => [newAlert, ...prev])
    showToast(`Simulated emergency alert ${newId} dispatched`)
  }

  const categories = ['All', ...new Set(items.map((a) => a.category))]

  const filtered = items.filter(
    (a) =>
      (severityFilter === 'All' || a.severity === severityFilter) &&
      (statusFilter === 'All' || a.status === statusFilter) &&
      (categoryFilter === 'All' || a.category === categoryFilter)
  )

  const counts = {
    Critical: items.filter((a) => a.severity === 'Critical' && a.status !== 'Resolved').length,
    Warning: items.filter((a) => a.severity === 'Warning' && a.status !== 'Resolved').length,
    Information: items.filter((a) => a.severity === 'Information' && a.status !== 'Resolved').length,
    Active: items.filter((a) => a.status === 'Active').length,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts & Risk"
        subtitle="Maritime alert centre — iceberg, sea-ice, weather, route, and data-quality signals."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleAcknowledgeAll}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/10"
              title="Move all active alerts to monitoring"
            >
              <Check size={13} className="text-safe" /> Ack All Active
            </button>
            <button
              onClick={handleSimulateAlert}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan/40 bg-cyan/15 px-3 py-1.5 text-xs font-semibold text-cyan transition hover:bg-cyan/25"
            >
              <BellPlus size={13} /> Simulate Alert
            </button>
          </div>
        }
      />

      {toastMessage && (
        <div className="animate-fade-in flex items-center justify-between rounded-xl border border-cyan/40 bg-navy-light/95 px-4 py-3 text-xs text-cyan shadow-lg shadow-cyan/10">
          <span className="font-semibold">{toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-mist hover:text-white">✕</button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active Critical Alerts" value={String(counts.Critical)} subtitle="Immediate attention required" icon={AlertTriangle} tone="danger" note="Simulated" />
        <StatCard label="Active Warnings" value={String(counts.Warning)} subtitle="Monitor conditions closely" icon={AlertCircle} tone="warn" note="Simulated" />
        <StatCard label="Total Requiring Action" value={String(counts.Active)} subtitle="Unacknowledged active state" icon={ShieldAlert} tone="cyan" note="Simulated" />
      </div>

      {/* Filter toolbar */}
      <div className="space-y-2.5 rounded-2xl border border-white/10 bg-navy-light/50 p-4">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium text-mist">Severity:</span>
            <div className="flex flex-wrap gap-1.5">
              {SEVERITY_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setSeverityFilter(f)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition',
                    severityFilter === f ? 'border-cyan/40 bg-cyan/10 text-cyan font-bold' : 'border-white/10 bg-white/5 text-mist hover:text-white'
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="h-4 w-px bg-white/10 hidden sm:block" />

          <div className="flex items-center gap-2">
            <span className="font-medium text-mist">Status:</span>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition',
                    statusFilter === s ? 'border-cyan/40 bg-cyan/10 text-cyan font-bold' : 'border-white/10 bg-white/5 text-mist hover:text-white'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
          <span className="text-xs font-medium text-mist">Category:</span>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-[11px] font-medium transition',
                categoryFilter === c ? 'border-cyan/40 bg-cyan/10 text-cyan font-bold' : 'border-white/5 bg-white/2 text-mist hover:text-white'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title="No alerts match the selected criteria"
          message="Adjust the severity, status, or category filter to inspect other simulated hazards."
          action={
            <button className="btn-secondary" onClick={() => { setSeverityFilter('All'); setStatusFilter('All'); setCategoryFilter('All') }}>
              Reset filters
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const CatIcon = CATEGORY_ICONS[a.category] ?? Snowflake
            const SevIcon = SEVERITY_ICONS[a.severity] ?? Info
            return (
              <Card key={a.id} className={cn('card-hover transition-all', a.status === 'Resolved' && 'opacity-60')}>
                <Card.Body>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-1 items-start gap-3.5 min-w-[280px]">
                      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', CATEGORY_TONES[a.category] ?? 'text-cyan bg-cyan/10')}>
                        <CatIcon size={20} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('inline-flex items-center gap-1 text-xs font-semibold', SEVERITY_TONES[a.severity])}>
                            <SevIcon size={13} /> {a.severity}
                          </span>
                          <span className="text-[11px] uppercase tracking-wider text-mist">{a.category}</span>
                          <span className="font-mono text-[11px] text-mist/60">{a.id}</span>
                          <Badge value={a.status} />
                        </div>
                        <h3 className="mt-1 text-[15px] font-semibold text-white">{a.title}</h3>
                        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-mist">{a.description}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-mist">
                          <span className="inline-flex items-center gap-1.5"><MapPin size={12} className="text-cyan" /> {a.location}</span>
                          <span className="inline-flex items-center gap-1.5"><Clock size={12} className="text-cyan" /> {a.time}</span>
                        </div>
                      </div>
                    </div>

                    {/* Operational action buttons */}
                    <div className="flex items-center gap-2 shrink-0 self-center">
                      {a.status === 'Active' && (
                        <button
                          onClick={() => handleStatusChange(a.id, 'Monitoring')}
                          className="inline-flex items-center gap-1 rounded-lg border border-warn/30 bg-warn/10 px-2.5 py-1.5 text-xs font-medium text-warn hover:bg-warn/20"
                        >
                          <Check size={13} /> Acknowledge
                        </button>
                      )}
                      {a.status === 'Monitoring' && (
                        <button
                          onClick={() => handleStatusChange(a.id, 'Resolved')}
                          className="inline-flex items-center gap-1 rounded-lg border border-safe/30 bg-safe/10 px-2.5 py-1.5 text-xs font-medium text-safe hover:bg-safe/20"
                        >
                          <CheckCircle2 size={13} /> Resolve
                        </button>
                      )}
                      {a.status === 'Resolved' && (
                        <button
                          onClick={() => handleStatusChange(a.id, 'Active')}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-mist hover:text-white"
                        >
                          <RotateCcw size={13} /> Reopen
                        </button>
                      )}
                      <button
                        onClick={() => handleDismiss(a.id)}
                        className="rounded-lg border border-white/5 bg-white/5 p-1.5 text-mist hover:text-danger hover:border-danger/20"
                        title="Dismiss alert"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </Card.Body>
              </Card>
            )
          })}
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-navy-deep/40 px-4 py-3">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-safe" />
        <p className="text-[11px] leading-relaxed text-mist">
          All alert actions (Acknowledge, Resolve, Reopen, Simulate) operate in real-time within the client session.
          All data is simulated demo data to demonstrate maritime decision-support workflows.
        </p>
      </div>
    </div>
  )
}