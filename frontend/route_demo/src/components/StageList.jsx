import React from 'react'

/**
 * The 7-step demo script, presented as a compact vertical list in the left
 * sidebar. Clicking a step (or Next/Back) visibly moves the demo, exactly as
 * the previous top bar did \u2014 only the footprint changed.
 */
export const STAGES = [
  { key: 'intro', num: 1, label: 'Intro', short: 'Intro', hint: 'problem, leg, data contract' },
  { key: 'environment', num: 2, label: 'Environment', short: 'Environment', hint: 'real SIC field' },
  { key: 'route', num: 3, label: 'Route', short: 'Route', hint: 'A* + CostMap optimization' },
  { key: 'change', num: 4, label: 'Change', short: 'Change', hint: 'D0 \u2192 D3 field difference' },
  { key: 'reroute', num: 5, label: 'Rerouting', short: 'Rerouting', hint: 're-plan on the later frame' },
  { key: 'intelligence', num: 6, label: 'System', short: 'System', hint: 'availability audit' },
  { key: 'final', num: 7, label: 'Result', short: 'Result', hint: 'final verified numbers' },
]

/** Right-rail intelligence card that belongs to each demo stage. */
export const STAGE_CARD = {
  intro: 'env',
  environment: 'env',
  route: 'route',
  change: 'unc',
  reroute: 'change',
  intelligence: 'sys',
  final: 'sys',
}

export default function StageList({ stage, setStage, flashKey }) {
  const idx = STAGES.findIndex((s) => s.key === stage)
  const go = (d) => {
    const n = Math.max(0, Math.min(STAGES.length - 1, idx + d))
    setStage(STAGES[n].key)
  }

  return (
    <div className="stageset" key={flashKey}>
      <div className="ss-nav">
        <button
          type="button"
          className="ss-arrow"
          onClick={() => go(-1)}
          disabled={idx <= 0}
          aria-label="previous stage"
        >
          &#9650;
        </button>
        <div className="ss-prog" aria-hidden="true">
          {STAGES.map((s, i) => (
            <i key={s.key} className={i === idx ? 'on' : i < idx ? 'done' : ''} />
          ))}
        </div>
        <button
          type="button"
          className="ss-arrow"
          onClick={() => go(1)}
          disabled={idx >= STAGES.length - 1}
          aria-label="next stage"
        >
          &#9660;
        </button>
      </div>

      <ol className="ss-list">
        {STAGES.map((s, i) => (
          <li key={s.key}>
            <button
              type="button"
              className={`ss-item ${s.key === stage ? 'active' : ''} ${i < idx ? 'done' : ''}`}
              onClick={() => setStage(s.key)}
              title={`${s.num}. ${s.label} — ${s.hint}`}
              aria-current={s.key === stage ? 'step' : undefined}
            >
              <span className="ss-i">{s.num}</span>
              <span className="ss-x">
                <span className="ss-l">{s.short}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
