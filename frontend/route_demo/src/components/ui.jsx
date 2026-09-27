import React from 'react'

export function Stat({ label, value, unit, tone, big }) {
  return (
    <div className={`m ${tone ? `tone-${tone}` : ''} ${big ? 'big' : ''}`}>
      <div className="l">{label}</div>
      <div className="v">
        {value}
        {unit ? <span style={{ fontSize: 10, opacity: 0.7 }}> {unit}</span> : null}
      </div>
    </div>
  )
}

export function Card({ title, icon, badge, badgeTone, tone, focus, children }) {
  return (
    <section className={`card ${tone ? `card-${tone}` : ''} ${focus ? 'focus' : ''}`}>
      <header className="card-head">
        {icon ? <span className="ic">{icon}</span> : null}
        <h3>{title}</h3>
        {badge ? (
          <span className={`card-badge ${badgeTone || ''}`}>{badge}</span>
        ) : null}
      </header>
      <div className="card-body">{children}</div>
    </section>
  )
}

export function Row({ label, value, mono }) {
  return (
    <div className="row">
      <span className="k">{label}</span>
      <span className={`v ${mono ? 'mono' : ''}`}>{value}</span>
    </div>
  )
}

export function Pill({ children, tone = 'neutral' }) {
  const cls = tone === 'neutral' ? '' : `pill-${tone}`
  return <span className={`pill ${cls}`}>{children}</span>
}

/** Primary action button. Always type="button" — never submits anything. */
export function ActionButton({ tone = 'primary', busy, busyLabel, children, onClick, disabled }) {
  return (
    <button
      type="button"
      className={`btn big btn-${tone}`}
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? <span className="spin" aria-hidden="true" /> : null}
      {busy ? busyLabel : children}
    </button>
  )
}

/* ---------------- number formatting helpers ---------------- */

export const fixed = (v, n) =>
  v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(n)

export function count(v) {
  return v == null ? '—' : Number(v).toLocaleString('en-US')
}

/** Signed delta with an honest "identical" case. */
export function delta(before, after, n = 4) {
  if (before == null || after == null) return { text: '—', cls: 'same' }
  const d = after - before
  if (Math.abs(d) < Math.pow(10, -n) / 2) return { text: '=', cls: 'same' }
  return {
    text: `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(n)}`,
    cls: d > 0 ? 'up' : 'dn',
  }
}
