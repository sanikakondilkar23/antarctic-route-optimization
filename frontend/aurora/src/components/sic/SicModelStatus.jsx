/**
 * SicModelStatus.jsx — provenance panel for the SIC model.
 *
 * Everything shown here is read from /api/sic/forecast's `model`, `checkpoints`
 * and `live_inference` blocks, which the backend derives from the actual
 * checkpoint files. Nothing is asserted by the frontend.
 */

import { Cpu, CheckCircle2, XCircle, Database, Clock } from 'lucide-react'
import Badge from '../ui/Badge'

function Row({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'good' ? 'text-safe' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-danger' : 'text-white/85'
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 text-[11px] text-mist">{label}</span>
      <span className={`truncate text-right font-mono text-[11px] ${toneClass}`} title={String(value)}>
        {value}
      </span>
    </div>
  )
}

export default function SicModelStatus({ forecast, checkpointSummary, className = '' }) {
  const live = forecast?.live_inference
  const grid = forecast?.grid
  const checkpoints = forecast?.checkpoints ?? []
  const allLoaded = checkpointSummary?.loaded === checkpointSummary?.expected

  return (
    <div className={className}>
      <div className="mb-2 flex items-center gap-2">
        <Cpu size={14} className="text-cyan" />
        <span className="text-xs font-semibold text-white/90">Model provenance</span>
        <Badge
          value={allLoaded ? `${checkpointSummary?.loaded}/${checkpointSummary?.expected} checkpoints` : 'checkpoint error'}
          className="ml-auto"
        />
      </div>

      <div className="rounded-xl border border-white/5 bg-navy-deep/50 px-3 py-2">
        <Row label="Architecture" value={checkpointSummary?.architecture ?? '—'} />
        <Row
          label="Parameters / checkpoint"
          value={checkpointSummary?.parameters?.toLocaleString() ?? '—'}
        />
        <Row
          label="Architecture matches weights"
          value={checkpointSummary?.architectureMatches ? 'yes (strict load)' : 'NO'}
          tone={checkpointSummary?.architectureMatches ? 'good' : 'bad'}
        />
        <Row label="Ensemble" value={`${checkpointSummary?.mcDropout ? '' : ''}${forecast?.model?.ensemble_seeds ?? 3} seeds`} />
        <Row
          label="MC Dropout"
          value={
            checkpointSummary?.mcDropout
              ? `p=${checkpointSummary.mcDropout.p} × ${checkpointSummary.mcDropout.passes_per_model} passes`
              : '—'
          }
        />
        <Row
          label="Conformal interval"
          value={
            checkpointSummary?.conformal
              ? `${Math.round(checkpointSummary.conformal.level * 100)}% stratified`
              : '—'
          }
        />
        <Row label="Horizons" value={`D+1 … D+${forecast?.horizons ?? 3}`} />
        {grid && (
          <Row
            label="Grid"
            value={`${grid.height}×${grid.width} @ ${grid.resolution_deg}° · ${grid.lat_range?.[0]}…${grid.lat_range?.[1]} lat`}
          />
        )}
        <Row label="Data source" value={forecast?.source ?? '—'} />
      </div>

      <div className="mt-3 rounded-xl border border-white/5 bg-navy-deep/50 px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <Database size={12} className="text-mist" />
          <span className="text-[11px] font-semibold text-white/85">Checkpoint load</span>
        </div>
        {checkpoints.length === 0 && (
          <p className="text-[11px] text-mist">No checkpoint report received.</p>
        )}
        {checkpoints.map((c) => (
          <div key={c.run} className="flex items-center gap-1.5 py-[2px]">
            {c.loaded ? (
              <CheckCircle2 size={11} className="shrink-0 text-safe" />
            ) : (
              <XCircle size={11} className="shrink-0 text-danger" />
            )}
            <span className="truncate font-mono text-[10px] text-mist" title={c.path}>
              {c.run}
            </span>
            {c.error && <span className="ml-auto text-[10px] text-danger">{c.error}</span>}
          </div>
        ))}
      </div>

      {live && (
        <div className="mt-3 rounded-xl border border-white/5 bg-navy-deep/50 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Clock size={12} className="text-mist" />
            <span className="text-[11px] font-semibold text-white/85">Live inference inputs</span>
          </div>
          <Row
            label="On-demand ConvLSTM pass"
            value={live.ready ? 'available' : 'unavailable'}
            tone={live.ready ? 'good' : 'warn'}
          />
          {!live.ready && (
            <ul className="mt-1 space-y-0.5">
              {(live.missing ?? []).map((m) => (
                <li key={m} className="font-mono text-[10px] leading-relaxed text-warn/90">
                  • {m}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
