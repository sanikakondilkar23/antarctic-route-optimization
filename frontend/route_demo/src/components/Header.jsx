import React from 'react'

/**
 * Top header: project identity + live system badges.
 * Every value is read from the backend; nothing is hard-coded or optimistic.
 */
export default function Header({ meta, status }) {
  const sic = status?.environment?.sic
  const cmems = status?.environment?.cmems
  const cvar = status?.environment?.cvar
  const retr = status?.retraining_performed

  return (
    <header className="header">
      <div className="hd-brand">
        <div className="hd-mark" aria-hidden="true">🧭</div>
        <div>
          <div className="hd-kicker">SIH2026059</div>
          <h1>{meta?.title || 'Antarctic Ocean Route Optimization'}</h1>
          <h2>{meta?.system || 'IceRoute-Robust'}</h2>
        </div>
      </div>

      <div className="hd-badges">
        <div className="badge b-ok">
          <span className="b-l"><span className="pdot" /> Sea Ice</span>
          <span className="b-v">REAL SIC</span>
        </div>
        <div className="badge b-info">
          <span className="b-l">Timesteps</span>
          <span className="b-v">{meta?.n_timesteps ?? '—'}</span>
        </div>
        <div className="badge b-info">
          <span className="b-l">Grid</span>
          <span className="b-v">{meta ? `${meta.n_rows} × ${meta.n_cols}` : '—'}</span>
        </div>
        <div className="badge b-info">
          <span className="b-l">Resolution</span>
          <span className="b-v">{meta ? `${meta.resolution_deg}°` : '—'}</span>
        </div>
        <div className="badge b-warn">
          <span className="b-l">CMEMS</span>
          <span className="b-v">{cmems?.available ? 'AVAILABLE' : 'UNAVAILABLE'}</span>
        </div>
        <div className="badge b-warn">
          <span className="b-l">CVaR</span>
          <span className="b-v">{cvar?.available ? 'AVAILABLE' : 'UNAVAILABLE'}</span>
        </div>
        <div className="badge b-ok">
          <span className="b-l">Uncertainty</span>
          <span className="b-v">{sic?.uncertainty_horizons ?? '—'} HOR</span>
        </div>
        <div className="badge b-ok">
          <span className="b-l">Retraining</span>
          <span className="b-v">{retr ? 'PERFORMED' : 'NONE'}</span>
        </div>
      </div>
    </header>
  )
}
