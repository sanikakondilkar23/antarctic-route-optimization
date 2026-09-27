import React from 'react'

/**
 * Map layer selector.
 *
 * A layer is only ever offered as enabled when the backend actually returns
 * real data for it. Anything else is listed but disabled and states
 * "Unavailable in current deployment" — we never draw a placeholder.
 */
export default function LayerPanel({ layers, setLayers, availability, bare = false }) {
  const ITEMS = [
    { key: 'sic', label: 'SIC', src: 'routing_sic_2026.npy', on: true },
    { key: 'nonNav', label: 'Non-navigable', src: 'NaN cells', on: true },
    { key: 'route', label: 'Route', src: 'A* + CostMap', on: true },
    { key: 'vessel', label: 'Vessel', src: 'route polyline', on: true },
    { key: 'uncertainty', label: 'Uncertainty', src: 'uncertainty_2026.npy', on: false },
    { key: 'current', label: 'Ocean Current', src: 'CMEMS uo/vo', on: false },
    { key: 'risk', label: 'Route Risk', src: 'SIC along route', on: false },
    { key: 'rerouteDiff', label: 'Difference', src: '/api/reroute/3', on: false },
  ]

  const list = (
    <div className="layers">
      {ITEMS.map((it) => {
        const ok = availability[it.key]
        const on = ok && layers[it.key]
        return (
          <button
            key={it.key}
            type="button"
            className={`layer ${on ? 'on' : ''} ${ok ? '' : 'off'}`}
            disabled={!ok}
            title={
              ok
                ? `${it.label} \u2014 ${it.src}`
                : `${it.label}: Unavailable in current deployment`
            }
            onClick={() => setLayers((l) => ({ ...l, [it.key]: !l[it.key] }))}
          >
            <span className="box">{on ? '\u2713' : ''}</span>
            <span className="txt">
              <span className="nm">{it.label}</span>
              {ok ? null : <span className="sr">unavailable</span>}
            </span>          </button>
        )
      })}
    </div>
  )

  if (bare) {
    return (
      <>
        {list}
        <div className="hint">
          Only layers backed by a real artifact are selectable.
        </div>
      </>
    )
  }

  return (
    <section className="card card-layers">
      <header className="card-head">
        <span className="ic">&#9635;</span>
        <h3>Map Layers</h3>
        <span className="card-badge">
          {ITEMS.filter((i) => availability[i.key]).length}/{ITEMS.length} live
        </span>
      </header>
      <div className="card-body">
        {list}
        <div className="hint">
          Only layers backed by a real artifact are selectable. Currents require the
          CMEMS Drive mount; iceberg-derived layers have no data.
        </div>
      </div>
    </section>
  )
}