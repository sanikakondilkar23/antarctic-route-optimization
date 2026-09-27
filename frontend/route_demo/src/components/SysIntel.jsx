import React from 'react'
import { fixed, Pill } from './ui.jsx'

/**
 * SYSTEM INTELLIGENCE
 *
 * An honest availability audit. Every line is derived from
 * GET /api/system/status, GET /api/models/ensemble and
 * GET /api/sic/metadata. Showing what is genuinely absent is far more
 * credible than silently hiding it.
 */
export default function SysIntel({ status, ensemble, meta, limitations, policyNote }) {
  const env = status?.environment || {}
  const sicf = status?.models?.sic_forecaster || {}
  const rp = status?.models?.route_policy || {}
  const members = ensemble?.members || []

  return (
    <section className="card card-sys">
      <header className="card-head">
        <span className="ic">&#9673;</span>
        <h3>System Intelligence</h3>
        <span className="card-badge">
          {status?.generated_utc ? `audit ${String(status.generated_utc).slice(0, 10)}` : 'audit'}
        </span>
      </header>
      <div className="card-body">
        <div className="si-sec">
          <div className="si-h">Data</div>
          <SiRow
            ok
            k="REAL SIC"
            v={`${meta?.n_timesteps ?? '—'} timesteps \u00b7 ${meta?.n_rows ?? '—'} \u00d7 ${meta?.n_cols ?? '—'}`}
            sub="backend/cache/routing_sic_2026.npy"
          />
          <SiRow
            ok={meta?.uncertainty_horizons > 0}
            k="SIC UNCERTAINTY"
            v={`${meta?.uncertainty_horizons ?? '—'} horizons \u00b7 ${(meta?.uncertainty_shape || []).join('\u00d7')}`}
            sub="backend/cache/uncertainty_2026.npy"
          />
          <SiRow
            ok={members.length > 0}
            k="SIC MODEL CHECKPOINTS"
            v={members.length ? `${members.length} available` : 'none found'}
            sub={members.map((m) => `seed ${m.seed}`).join(' \u00b7 ')}
          />
          <SiRow
            ok={false}
            tone="warn"
            k="RAW SIC INPUTS"
            v="NOT AVAILABLE FOR RE-INFERENCE"
            sub="raw 2026 multi-channel tensors are not in this deployment"
          />
          <SiRow
            ok={false}
            tone="warn"
            k="CMEMS"
            v={env.cmems?.available ? 'available' : 'UNAVAILABLE IN CURRENT DEPLOYMENT'}
            sub={env.cmems?.note || 'Drive mount not configured'}
          />
          <SiRow
            ok={false}
            tone="warn"
            k="CVaR"
            v="UNAVAILABLE \u2014 iceberg risk layers absent"
            sub="no CVaR value is computed or claimed"
          />
        </div>

        <div className="si-sec">
          <div className="si-h">SIC forecast ensemble</div>
          {members.length ? (
            <>
              <div className="ens">
                {members.map((m) => (
                  <div className="ens-c" key={m.run}>
                    <div className="eh">
                      <Pill tone={m.checkpoint_present ? 'ok' : 'bad'}>
                        {m.checkpoint_present ? '\u2713' : '\u2717'} seed {m.seed}
                      </Pill>
                    </div>
                    <div className="er"><span>val loss</span><b>{fixed(m.metrics?.val_loss, 5)}</b></div>
                    <div className="er"><span>MIZ D+1</span><b>{fixed(m.metrics?.miz_day1, 4)}</b></div>
                    <div className="er"><span>MIZ mean</span><b>{fixed(m.metrics?.miz_mean, 4)}</b></div>
                    <div className="er">
                      <span>vs persist</span>
                      <b>{fixed(m.metrics?.ratio_day1, 3)} / {fixed(m.metrics?.ratio_day3, 3)}</b>
                    </div>
                    <div className="er"><span>best epoch</span><b>{m.metrics?.best_epoch ?? '—'}</b></div>
                  </div>
                ))}
              </div>
              <div className="hint">
                Per-seed MIZ RMSE and the persistence ratios are the checkpoints&apos; own
                recorded validation metrics (2025 validation split), read from
                backend/runs/*/metrics.json.
              </div>
              <div className="note">
                The committed 2026 forecast artifact is used by the routing pipeline.
                Raw 2026 inference inputs are not present in this deployment, so ConvLSTM
                inference is <b>not</b> re-run here.
              </div>
            </>
          ) : (
            <div className="hint">Ensemble metadata unavailable.</div>
          )}
        </div>

        <div className="si-sec">
          <div className="si-h">Route ML policy &mdash; research component</div>
          <div className="row">
            <span className="k">Architecture</span>
            <span className="v mono" style={{ fontSize: 10 }}>
              {rp.architecture || '16 \u2192 64 \u2192 32 \u2192 8'}
            </span>
          </div>
          <div className="row">
            <span className="k">Training domain</span>
            <span className="v">Synthetic 20 \u00d7 25 smoke environment</span>
          </div>
          <div className="row">
            <span className="k">Deployment</span>
            <span className="v">Safety-gated / expert fallback</span>
          </div>
          <div className="row">
            <span className="k">Status</span>
            <span className="v">Research / demo component</span>
          </div>
          <div className="note">
            {policyNote ||
              'The policy is not presented as a real Antarctic accuracy figure. On the real 173\u00d7369 grid it did not reach the goal because n_rows / n_cols / distance features are out of distribution; the safety layer constrained every step to the expert path. The shipped route is A* + CostMap on real SIC.'}
          </div>
        </div>

        <div className="si-sec">
          <div className="si-h">Integrity</div>
          <div className="ig">
            <Pill tone={status?.retraining_performed === false ? 'ok' : 'warn'}>
              Retraining: {status?.retraining_performed === false ? 'NONE' : 'REPORTED'}
            </Pill>
            <Pill tone={status?.synthetic_route_data_used === false ? 'ok' : 'warn'}>
              Synthetic route data used: {status?.synthetic_route_data_used === false ? 'NO' : 'YES'}
            </Pill>
            <Pill tone="info">
              Tests: {ensemble?.verification?.tests_passed == null
                ? '—'
                : `${ensemble.verification.tests_passed} passed / ${ensemble.verification.tests_failed} failed`}
            </Pill>
          </div>
          {limitations ? (
            <div className="lims">
              {Object.entries(limitations).map(([k, v]) => (
                <div className="lim" key={k}>
                  <span className="lk">{k.toUpperCase()}</span>
                  <span className="lv">{v}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function SiRow({ ok, k, v, sub, tone }) {
  const t = tone || (ok ? 'ok' : 'off')
  return (
    <div className={`si-row si-${t}`}>
      <span className="si-ic">{ok ? '\u2713' : '\u26a0'}</span>
      <div className="si-txt">
        <div className="si-k">{k}</div>
        <div className="si-v">{v}</div>
        {sub ? <div className="si-s">{sub}</div> : null}
      </div>
    </div>
  )
}
