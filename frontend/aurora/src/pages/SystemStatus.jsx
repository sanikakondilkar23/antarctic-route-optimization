/**
 * SystemStatus.jsx - the deployment telling the truth about itself.
 *
 * Every field below is a verbatim value from /api/health, /api/system/status,
 * /api/models/ensemble, /api/layers/status and /api/limitations. No summary
 * score, no health percentage, no uptime claim: just what the API returns.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  RefreshCw,
  ServerCrash,
  XCircle,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { LoadingState } from '../components/ui/Status'
import {
  fetchEnsemble,
  fetchHealth,
  fetchIcebergStatus,
  fetchLayersStatus,
  fetchLimitations,
  fetchSystemStatus,
} from '../lib/auroraApi'
import { fmtTimestamp } from '../data'

const yes = (v) => (v ? 'yes' : 'no')

/**
 * `/api/system/status` reports `dataset_location` either as a plain string or
 * as an object (`{env_var, hint, resolution, resolved_root, searched_roots}`).
 * Rendering that object directly would crash React, so it is flattened to the
 * fields that are themselves strings, and nothing is invented when they are
 * absent.
 */
function locationText(loc) {
  if (typeof loc === 'string') return loc
  if (loc && typeof loc === 'object') {
    const parts = [loc.resolution, loc.resolved_root, loc.hint]
      .filter((v) => typeof v === 'string' && v.length > 0)
    if (parts.length) return parts.join(' · ')
    if (Array.isArray(loc.searched_roots) && loc.searched_roots.length) {
      return `searched ${loc.searched_roots.join(', ')}`
    }
    return 'not reported'
  }
  return '—'
}

function KV({ k, v, tone }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-1.5 last:border-0">
      <span className="shrink-0 text-[11px] text-mist">{k}</span>
      <span
        className={`break-all text-right font-mono text-[11px] ${
          tone === 'good' ? 'text-safe' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-danger' : 'text-white/85'
        }`}
      >
        {typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)}
      </span>
    </div>
  )
}

function Flag({ ok, good = 'AVAILABLE', bad = 'UNAVAILABLE' }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-safe">
      <CheckCircle2 size={13} /> {good}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-warn">
      <XCircle size={13} /> {bad}
    </span>
  )
}

export default function SystemStatus() {
  const [health, setHealth] = useState(null)
  const [system, setSystem] = useState(null)
  const [ensemble, setEnsemble] = useState(null)
  const [iceberg, setIceberg] = useState(null)
  const [layers, setLayers] = useState(null)
  const [limitations, setLimitations] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState(fmtTimestamp())

  const load = useCallback(async () => {
    setBusy(true)
    const [h, s, e, l, lim, ib] = await Promise.allSettled([
      fetchHealth(),
      fetchSystemStatus(),
      fetchEnsemble(),
      fetchLayersStatus(0),
      fetchLimitations(),
      fetchIcebergStatus(),
    ])
    if (h.status === 'fulfilled') setHealth(h.value)
    if (s.status === 'fulfilled') setSystem(s.value)
    if (e.status === 'fulfilled') setEnsemble(e.value)
    if (l.status === 'fulfilled') setLayers(l.value)
    if (lim.status === 'fulfilled') setLimitations(lim.value)
    if (ib.status === 'fulfilled') setIceberg(ib.value)
    const firstFailure = [h, s, e, l, lim].find((r) => r.status === 'rejected')
    setError(firstFailure ? firstFailure.reason?.message ?? 'some endpoints failed' : null)
    setAt(fmtTimestamp())
    setBusy(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const env = system?.environment ?? {}
  const models = system?.models ?? {}
  const verification = ensemble?.verification ?? null
  const datasets = system?.datasets ?? {}

  return (
    <div className="space-y-6">
      <PageHeader
        title="System status"
        subtitle="Availability, provenance and limitations exactly as the AURORA API reports them."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LiveChip
              label={health?.status === 'ok' ? 'backend online' : health ? 'unexpected health payload' : 'backend unreachable'}
              dot={health?.status === 'ok' ? 'safe' : 'danger'}
            />
            <span className="font-mono text-[11px] text-mist">{at}</span>
            <Button variant="secondary" onClick={load} disabled={busy} className="!px-4">
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Reload
            </Button>
          </div>
        }
      />

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-5 py-4 text-danger">
          <ServerCrash size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Some status endpoints did not respond</p>
            <p className="text-xs leading-relaxed text-danger/90">{error}</p>
          </div>
        </div>
      )}

      {!system && !error && <LoadingState label="Reading /api/system/status" />}

      {system && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-4">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">
                <Database size={13} /> Project
              </p>
              <p className="mt-1.5 font-display text-lg font-bold text-white">{system.project}</p>
              <p className="text-xs text-mist">{system.system} · {system.title}</p>
            </Card>
            <Card className="p-4">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">
                <Activity size={13} /> Health
              </p>
              <p className={`mt-1.5 font-display text-lg font-bold ${health?.status === 'ok' ? 'text-safe' : 'text-danger'}`}>
                {health?.status ?? 'no response'}
              </p>
              <p className="text-xs text-mist">
                SIC artifact {yes(health?.sic_artifact)} · route artifact {yes(health?.route_artifact)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">
                <Layers size={13} /> Cost terms active
              </p>
              <p className="mt-1.5 font-display text-lg font-bold text-white">
                {(layers?.cost_breakdown?.terms ?? []).join(', ') || '—'}
              </p>
              <p className="text-xs text-mist">
                {layers ? `${layers.real?.length ?? 0} real · ${layers.partial?.length ?? 0} partial · ${layers.not_available?.length ?? 0} unavailable` : 'loading…'}
              </p>
            </Card>
            <Card className="p-4">
              <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mist">
                <AlertTriangle size={13} /> Retraining
              </p>
              <p className="mt-1.5 font-display text-lg font-bold text-white">{yes(system.retraining_performed)}</p>
              <p className="text-xs text-mist">synthetic route data used: {yes(system.synthetic_route_data_used)}</p>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <Card.Header
                title="Environment layers"
                subtitle="GET /api/system/status → environment"
                icon={Layers}
              />
              <Card.Body className="space-y-3">
                {[
                  ['Sea-ice concentration', env.sic],
                  ['Ocean currents (CMEMS)', env.cmems],
                  ['Iceberg risk', env.iceberg],
                  ['CVaR', env.cvar],
                ].map(([label, obj]) => (
                  <div key={label} className="rounded-xl border border-white/5 bg-navy-deep/45 px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white/90">{label}</span>
                      <Flag ok={obj?.available} good={obj?.computed ? 'COMPUTED' : 'AVAILABLE'} bad={obj?.computed ? 'NOT COMPUTED' : 'UNAVAILABLE'} />
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-white/85">{obj?.label}</p>
                    {obj?.note && <p className="mt-1 text-[11px] leading-relaxed text-mist">{obj.note}</p>}
                    {obj?.nan_policy && <p className="mt-1 font-mono text-[10px] text-mist">{obj.nan_policy}</p>}
                  </div>
                ))}
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Models" subtitle="checkpoints detected on disk" icon={Database} />
              <Card.Body className="space-y-3">
                <div className="rounded-xl border border-white/5 bg-navy-deep/45 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white/90">SIC forecaster (ConvLSTM)</span>
                    <Flag ok={models.sic_forecaster?.present} good="PRESENT" bad="MISSING" />
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/85">{models.sic_forecaster?.label}</p>
                  <p className="mt-1 font-mono text-[10px] text-mist">
                    {models.sic_forecaster?.checkpoints?.length ?? 0} checkpoint(s) · inference re-run:{' '}
                    {yes(models.sic_forecaster?.inference_rerun_possible)}
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {(models.sic_forecaster?.checkpoints ?? []).map((c) => (
                      <p key={c.path ?? c.run} className="truncate font-mono text-[10px] text-mist" title={c.path}>
                        {c.path ?? c.run} {c.is_sic_forecaster ? '· sic forecaster' : ''}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-white/5 bg-navy-deep/45 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white/90">Route ML policy</span>
                    <Flag ok={models.route_policy?.present} good="PRESENT" bad="MISSING" />
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/85">{models.route_policy?.label}</p>
                  <div className="mt-1.5">
                    <KV k="architecture" v={models.route_policy?.architecture} />
                    <KV k="training data" v={models.route_policy?.training_data} tone="warn" />
                    <KV k="used for final route" v={yes(models.route_policy?.used_for_final_route)} tone="good" />
                    <KV k="real Antarctic accuracy claimed" v={yes(models.route_policy?.is_real_antarctic_accuracy)} tone="warn" />
                  </div>
                </div>

                <div className="rounded-xl border border-white/5 bg-navy-deep/45 px-3.5 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white/90">Iceberg detector (YOLOv8)</span>
                    <Flag ok={iceberg?.checkpoint_present} good="PRESENT" bad="MISSING" />
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/85">
                    {iceberg ? `model status ${iceberg.model_status} · ${iceberg.georeferencing?.status}` : 'status unavailable'}
                  </p>
                  <div className="mt-1.5">
                    <KV k="checkpoint sha256" v={iceberg?.checkpoint_sha256 ?? '—'} />
                    <KV k="route consumes iceberg risk" v={yes(iceberg?.route_consumes_iceberg_risk)} tone={iceberg?.route_consumes_iceberg_risk ? 'good' : 'warn'} />
                  </div>
                </div>
              </Card.Body>
            </Card>
          </div>

          {verification && (
            <Card>
              <Card.Header
                title="Validation record"
                subtitle={verification.source}
                icon={CheckCircle2}
                action={<Badge value={verification.tests_status === 'PASSED' ? 'Recommended' : 'Warning'} />}
              />
              <Card.Body className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-white/85">
                    tests {verification.tests_passed} passed{verification.tests_failed ? `, ${verification.tests_failed} failed` : ''}
                  </span>
                  <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-white/85">
                    cvar computed: {yes(verification.cvar_computed)}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-white/85">{verification.overall_status}</p>
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-warn">Warnings</p>
                  {(verification.warnings ?? []).map((w) => (
                    <div key={w} className="rounded-lg border border-warn/20 bg-warn/5 px-3 py-2 text-[11px] leading-relaxed text-white/85">
                      {w}
                    </div>
                  ))}
                </div>
              </Card.Body>
            </Card>
          )}

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <Card.Header title="Routing" subtitle="GET /api/system/status → routing" icon={Layers} />
              <Card.Body>
                {Object.entries(system.routing ?? {}).map(([k, v]) => (
                  <KV key={k} k={k} v={v} />
                ))}
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Datasets" subtitle="configured data sources" icon={Database} />
              <Card.Body className="space-y-1.5">
                {Object.entries(datasets).map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-3 border-b border-white/5 pb-1.5 last:border-0">
                    <span className="font-mono text-[11px] text-white/85">{k}</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-mist">{d.configured ? 'configured' : 'not configured'}</span>
                      <Flag ok={d.exists} good="PRESENT" bad="ABSENT" />
                    </span>
                  </div>
                ))}
                <p className="pt-1 text-[11px] leading-relaxed text-mist">
                  data root env var: <span className="font-mono">{layers?.data_root_env ?? 'SIH_DATA_ROOT'}</span>
                  {' · '}location: {locationText(system.dataset_location)}
                </p>
              </Card.Body>
            </Card>
          </div>

          <Card>
            <Card.Header title="Limitations" subtitle="GET /api/limitations — verbatim" icon={AlertTriangle} />
            <Card.Body className="grid gap-2.5 sm:grid-cols-2">
              {Object.entries(limitations ?? system.limitations ?? {}).map(([k, text]) => (
                <div key={k} className="rounded-xl border border-warn/20 bg-warn/5 px-3.5 py-2.5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-warn">{k}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/85">{text}</p>
                </div>
              ))}
            </Card.Body>
          </Card>
        </>
      )}
    </div>
  )
}
