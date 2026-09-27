import React from 'react'
import { count, fixed } from './ui.jsx'

/**
 * DATA QUALITY
 *
 * Real per-timestep numbers from GET /api/sic/<t>. The NaN contract is the
 * point of this panel: NaN cells are treated as non-navigable and are NEVER
 * zero-filled, which is why non-navigable count is a first-class metric
 * rather than a rounding detail.
 */
export default function DataQuality({ slice, meta, uncertainty }) {
  const s = slice?.stats
  const total = s?.n_cells ?? meta?.n_rows * meta?.n_cols
  const nav = s?.n_navigable
  const nonNav = s?.n_non_navigable
  const navPct = nav != null && total ? (nav / total) * 100 : null

  return (
    <section className="card card-dq">
      <header className="card-head">
        <span className="ic">&#9634;</span>
        <h3>Data Quality</h3>
        <span className="card-badge">{slice ? `D${slice.timestep} \u00b7 ${slice.date}` : '—'}</span>
      </header>
      <div className="card-body">
        <div className="mgrid">
          <div className="m">
            <div className="l">Total cells</div>
            <div className="v">{count(total)}</div>
          </div>
          <div className="m">
            <div className="l">Navigable</div>
            <div className="v tone-ok">{count(nav)}</div>
          </div>
          <div className="m">
            <div className="l">Non-navigable</div>
            <div className="v tone-warn">{count(nonNav)}</div>
          </div>
          <div className="m">
            <div className="l">SIC min</div>
            <div className="v">{fixed(s?.min, 4)}</div>
          </div>
          <div className="m">
            <div className="l">SIC mean</div>
            <div className="v">{fixed(s?.mean, 4)}</div>
          </div>
          <div className="m">
            <div className="l">SIC max</div>
            <div className="v">{fixed(s?.max, 4)}</div>
          </div>
        </div>

        <div className="navbar">
          <div className="nb-fill" style={{ width: `${navPct == null ? 0 : navPct}%` }} />
          <span className="nb-t">
            {navPct == null ? '—' : `${navPct.toFixed(1)}% navigable`}
          </span>
        </div>

        {uncertainty?.stats ? (
          <div className="dq-unc">
            <span>Uncertainty coverage (H{uncertainty.horizon + 1})</span>
            <b>
              {count(uncertainty.stats.n_within_model_domain)} of{' '}
              {count(uncertainty.stats.n_cells)} cells
            </b>
          </div>
        ) : null}

        <div className="note ok-note">
          NaN cells are treated as non-navigable and are never zero-filled.
        </div>
        <div className="hint">
          {meta?.nan_policy || 'NaN encoding: sic_u8 value + valid bitmask; valid = 0 means non-navigable.'}
        </div>
        {meta?.notes_lon_domain ? (
          <div className="hint">
            Model band rows 0&ndash;100 / cols 0&ndash;360. Outside it there is no model output;
            those cells carry NaN rather than a fabricated value.
          </div>
        ) : null}
      </div>
    </section>
  )
}
