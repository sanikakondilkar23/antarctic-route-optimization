import React, { useState } from 'react'

/**
 * Compact collapsible section used by both sidebars.
 *
 * The dashboard is information-dense by design, but the default state has to
 * stay quiet: the map is the primary visual, so every side panel opens as a
 * single summary row and only reveals its detail on demand.
 */
export default function SideSection({
  title, icon, badge, badgeTone, open: initialOpen = false, tone, children,
}) {
  const [open, setOpen] = useState(initialOpen)

  return (
    <section className={`side ${open ? 'open' : ''} ${tone ? `side-${tone}` : ''}`}>
      <button
        type="button"
        className="side-head"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {icon ? <span className="side-ic" aria-hidden="true">{icon}</span> : null}
        <span className="side-t">{title}</span>
        {badge ? <span className={`side-badge ${badgeTone || ''}`}>{badge}</span> : null}
        <span className="side-caret" aria-hidden="true">{open ? '\u2212' : '+'}</span>
      </button>
      {open ? <div className="side-body">{children}</div> : null}
    </section>
  )
}
