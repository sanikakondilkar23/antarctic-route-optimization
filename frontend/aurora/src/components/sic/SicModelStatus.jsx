/**
 * SicModelStatus.jsx - provenance panel for the SIC ConvLSTM ensemble.
 *
 * Everything rendered here is read from GET /api/models/ensemble (the three
 * checkpoints' own recorded metrics) and GET /api/sic/metadata (the committed
 * forecast artifact). Nothing is asserted by the frontend and no number is
 * recomputed: the metrics are exactly what the training runs wrote.
 */

import { Cpu, CheckCircle2, XCircle, Database, Clock, ShieldCheck } from 'lucide-react'
import Badge from '../ui/Badge'

function Row({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'good'
      ? 'text-safe'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'bad'
          ? 'text-danger'
          : 'text-white/85'
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-[11px] text-mist">{label}</span>
      <span className={`truncate text-right font-mono text-[11px] ${toneClass}`} title={String(value)}>
        {value}
      </span>
    </div>
  )
}

const num = (v, d = 4) => (typeof v === 'number' ? v.toFixed(d) : '-')

export default function SicModelStatus({ ensemble, metadata, className = '' }) {
  const members = ensemble?.members ?? []
  const verification = ensemble?.verification ?? null
  const loaded = members.filter((m) => m.checkpoint_present).length
  const allLoaded = ensemble ? loaded === (ensemble.n_members ?? members.length) : false

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <Cpu size={14} className="text-cyan" />
        <span className="text-xs font-semibold text-white/90">Model provenance</span>
        <Badge
          value={ensemble ? `${loaded}/${ensemble.n_members} checkpoints` : 'status unavailable'}
          className="ml-auto"
        />
      </div>

      <div className="rounded-xl border border-white/5 bg-navy-deep/50 px-3 py-2">
        <Row label="Architecture" value={ensemble?.architecture ?? '-'} />
        <Row
          label="Parameters / checkpoint"
          value={ensemble?.param_count ? ensemble.param_count.toLocaleString() : '-'}
        />
        <Row label="Ensemble" value={ensemble ? `${ensemble.n_members} seeds` : '-'} />
        <Row label="Horizons" value={ensemble ? `D+1 – D+${ensemble.horizons}` : '-'} />
        <Row
          label="Checkpoints present"
          value={ensemble ? (allLoaded ? 'yes' : 'NO') : '-'}
          tone={ensemble ? (allLoaded ? 'good' : 'bad') : 'default'}
        />
        {metadata && (
          <Row
            label="Forecast artifact"
            value={`${metadata.n_timesteps} days · ${metadata.n_rows}×${metadata.n_cols} @ ${metadata.resolution_deg}°`}
          />
        )}
        {metadata && <Row label="Window" value={`${metadata.date_range?.[0]} → ${metadata.date_range?.[1]}`} />}
        <Row
          label="ConvLSTM inference at request time"
          value={ensemble?.inference_rerun_possible ? 'possible' : 'NOT re-run (raw inputs absent)'}
          tone={ensemble?.inference_rerun_possible ? 'good' : 'warn'}
        />
      </div>

      <div className="mt-3 rounded-xl border border-white/5 bg-navy-deep/50 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Database size={12} className="text-mist" />
          <span className="text-[11px] font-semibold text-white/85">Recorded training metrics (read-only)</span>
        </div>
        {members.length === 0 && (
          <p className="text-[11px] text-mist">No ensemble report received from the API.</p>
        )}
        {members.map((m) => (
          <div key={m.run} className="flex items-center gap-1.5 py-[2px]">
            {m.checkpoint_present ? (
              <CheckCircle2 size={11} className="shrink-0 text-safe" />
            ) : (
              <XCircle size={11} className="shrink-0 text-danger" />
            )}
            <span className="truncate font-mono text-[10px] text-mist" title={m.checkpoint ?? m.run}>
              {m.run}
            </span>
            <span className="ml-auto font-mono text-[10px] text-white/80">
              {m.metrics
                ? `val ${num(m.metrics.val_loss, 5)} · MIZ/persist d1 ${num(m.metrics.ratio_day1, 2)}`
                : 'no metrics file'}
            </span>
          </div>
        ))}
        {ensemble?.note && (
          <p className="mt-1.5 text-[10px] leading-relaxed text-mist/80">{ensemble.note}</p>
        )}
      </div>

      {verification && (
        <div className="mt-3 rounded-xl border border-white/5 bg-navy-deep/50 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <ShieldCheck size={12} className="text-mist" />
            <span className="text-[11px] font-semibold text-white/85">System validation record</span>
          </div>
          <Row
            label="Tests"
            value={
              verification.tests_status
                ? `${verification.tests_status} (${verification.tests_passed} passed${verification.tests_failed ? `, ${verification.tests_failed} failed` : ''})`
                : 'not recorded'
            }
            tone={verification.tests_passed ? 'good' : 'default'}
          />
          <Row label="Source" value={verification.source ?? '-'} />
          {verification.overall_status && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-white/85">{verification.overall_status}</p>
          )}
          {(verification.warnings ?? []).length > 0 && (
            <div className="mt-1.5 space-y-1">
              {verification.warnings.map((w) => (
                <p key={w} className="rounded border border-warn/20 bg-warn/5 px-2 py-1 text-[10px] leading-relaxed text-white/85">
                  {w}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 rounded-xl border border-white/5 bg-navy-deep/50 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Clock size={12} className="text-mist" />
          <span className="text-[11px] font-semibold text-white/85">Data policy</span>
        </div>
        <p className="text-[10px] leading-relaxed text-mist">{metadata?.nan_policy}</p>
      </div>
    </div>
  )
}
