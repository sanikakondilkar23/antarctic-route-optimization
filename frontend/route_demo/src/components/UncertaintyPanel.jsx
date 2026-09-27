import React from 'react'
import MiniField from './MiniField.jsx'
import { count, fixed } from './ui.jsx'

/**
 * FORECAST UNCERTAINTY
 *
 * Reads the committed artifact backend/cache/uncertainty_2026.npy
 * (167 timesteps x 3 lead-time horizons x 101 x 361) through
 * GET /api/uncertainty/<t>?horizon=<h>.
 *
 * The artifact lives on the ConvLSTM model band only (lat -75..-50,
 * lon -10..80). Cells outside that band are returned as NaN and are drawn as
 * "no value" — they are NOT treated as zero uncertainty.
 *
 * No physical unit is asserted: the artifact provides the spread on the SIC
 * fraction scale, and that is exactly what is stated below.
 */
export default function UncertaintyPanel({
  meta, sic, uncertainty, horizon, setHorizon, summary, loading, sideBySide, setSideBySide,
  onOverlay,
}) {
  const nH = uncertainty?.n_horizons ?? meta?.uncertainty_horizons ?? 3
  const st = uncertainty?.stats
  const umax = st?.max ?? null

  return (
    <section className="card card-unc">
      <header className="card-head">
        <span className="ic">&#9673;</span>
        <h3>Forecast Uncertainty</h3>
        <span className={`card-badge ${uncertainty ? 'ok' : 'busy'}`}>
          {uncertainty ? `${nH} horizons` : 'loading'}
        </span>
      </header>
      <div className="card-body">
        <div className="hz">
          <span className="hz-k">Lead-time horizon</span>
          {[0, 1, 2].slice(0, nH).map((h) => (
            <button
              key={h}
              type="button"
              className={`hz-b ${h === horizon ? 'on' : ''}`}
              onClick={() => setHorizon(h)}
            >
              Horizon {h + 1}
              <em>D+{h + 1}</em>
            </button>
          ))}
        </div>

        <div className="sbs">
          <MiniField
            slice={sic}
            lat={meta.lat} lon={meta.lon} mode="sic"
            label="SIC FORECAST" sub={sic ? sic.date : '\u2026'}
            tone="before" active={!sideBySide}
          />
          <MiniField
            slice={uncertainty} lat={meta.lat} lon={meta.lon} mode="uncertainty" max={umax}
            label="UNCERTAINTY"
            sub={st ? `0 \u2192 ${fixed(st.max, 3)}` : '\u2026'}
            tone="unc" active={sideBySide}
            onClick={() => setSideBySide((s) => !s)}
          />
        </div>

        {loading && !uncertainty ? <div className="hint">Reading uncertainty_2026.npy\u2026</div> : null}

        {st ? (
          <>
            <div className="mgrid c2">
              <div className="m">
                <div className="l">Mean (model band)</div>
                <div className="v">{fixed(st.mean, 4)}</div>
              </div>
              <div className="m">
                <div className="l">Median</div>
                <div className="v">{fixed(st.median, 4)}</div>
              </div>
              <div className="m">
                <div className="l">p90</div>
                <div className="v">{fixed(st.p90, 4)}</div>
              </div>
              <div className="m">
                <div className="l">Max</div>
                <div className="v">{fixed(st.max, 4)}</div>
              </div>
            </div>

            <div className="coverage">
              <div className="cv">
                <span>Within model domain</span>
                <b>{count(st.n_within_model_domain)}</b>
              </div>
              <div className="cv">
                <span>Outside (no value)</span>
                <b>{count(st.n_outside_model_domain)}</b>
              </div>
            </div>
          </>
        ) : null}

        <div className="note">
          Higher uncertainty = less confidence in the forecast SIC for that cell at this
          lead time. The uncertainty layer covers the ConvLSTM model band only
          (lat &minus;75&hellip;&minus;50&deg;, lon &minus;10&hellip;80&deg;); outside it the
          artifact has no value and none is assumed.
        </div>

        {summary?.available ? (
          <div className="unc-hist">
            <div className="uh">Committed distribution (all timesteps)</div>
            <div className="uh-row">
              <span>MIZ mean &sigma;</span>
              <b>{fixed(summary.miz_mean_std, 4)}</b>
            </div>
            <div className="uh-row">
              <span>MIZ p10 &rarr; p90</span>
              <b>{fixed(summary.miz_p10_std, 4)} &rarr; {fixed(summary.miz_p90_std, 4)}</b>
            </div>
            <div className="uh-row">
              <span>Full-grid mean &sigma;</span>
              <b>{fixed(summary.full_mean_std, 4)}</b>
            </div>
            <div className="hint">
              Source: {summary.source}. {summary.units}.
            </div>
          </div>
        ) : null}

        <div className="btn-row">
          <button
            type="button"
            className={`btn sm ${sideBySide ? 'btn-primary' : ''}`}
            onClick={() => setSideBySide((s) => !s)}
          >
            {sideBySide ? 'Show as map layer' : 'Side-by-side view'}
          </button>
          <button type="button" className="btn sm ghost" onClick={onOverlay}>
            Overlay on chart
          </button>
        </div>
      </div>
    </section>
  )
}
