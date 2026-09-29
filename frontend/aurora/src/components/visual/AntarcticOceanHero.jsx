/**
 * AntarcticOceanHero - the landing-page visual for AURORA.
 *
 * A hand-authored SVG of the Southern Ocean: dark water, an ice shelf, floes,
 * drifting current lines and a plotted passage. It is original artwork drawn
 * for this repository - no third-party photograph, no traced map, no satellite
 * imagery. Nothing in it is data: every measured value the product shows comes
 * from the AURORA API. The caption says so on the artwork itself.
 */

const WAVE_ROWS = Array.from({ length: 16 }, (_, i) => 348 + i * 26)

/** Long, slow swells drawn as shallow cubic curves across the frame. */
const swell = (y, amp, phase) => {
  const p = phase * 90
  return (
    `M -40 ${y}` +
    ` C 160 ${y - amp} 320 ${y + amp} 520 ${y - amp * 0.75}` +
    ` S 880 ${y + amp * 0.9} 1080 ${y - amp * 0.5}` +
    ` S 1260 ${y + amp * 0.4} 1340 ${y + p * 0.02}`
  )
}

const FLOES = [
  [148, 512, 34, 11, -12],
  [268, 596, 46, 14, 8],
  [452, 486, 26, 9, -6],
  [612, 640, 58, 16, 4],
  [762, 540, 30, 10, -14],
  [880, 664, 40, 13, 6],
  [980, 500, 22, 8, -9],
  [356, 700, 52, 15, 3],
  [1088, 588, 34, 11, -5],
  [60, 636, 44, 13, 10],
]

/** Distant berg silhouettes sitting on the horizon line. */
const BERGS = [
  [196, 302, 26, 17],
  [318, 305, 16, 11],
  [560, 303, 21, 14],
  [700, 306, 13, 9],
  [862, 302, 30, 19],
  [1044, 305, 18, 12],
]

const SHELF =
  'M 760 760 C 742 690 776 636 846 604 C 916 572 964 536 1030 520 ' +
  'C 1098 504 1156 512 1240 508 L 1240 760 Z'

const SHELF_EDGE =
  'M 760 760 C 742 690 776 636 846 604 C 916 572 964 536 1030 520 ' +
  'C 1098 504 1156 512 1240 508'

const CONTOURS = [
  'M 812 760 C 806 704 838 664 894 640 C 954 614 1000 586 1054 574 C 1112 562 1166 568 1240 564',
  'M 866 760 C 866 718 894 688 942 670 C 994 650 1036 628 1084 618 C 1136 608 1186 614 1240 612',
  'M 922 760 C 926 730 950 710 990 696 C 1034 680 1072 664 1114 656 C 1158 648 1200 652 1240 650',
]

const PASSAGE =
  'M 40 706 C 176 662 268 610 372 566 C 486 518 566 470 664 440 ' +
  'C 762 410 872 402 986 414'

const WAYPOINTS = [
  [40, 706],
  [372, 566],
  [664, 440],
  [986, 414],
]

export default function AntarcticOceanHero({ className = '' }) {
  return (
    <svg
      viewBox="0 0 1200 760"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Illustration of the Southern Ocean with an ice shelf, drifting ice and a plotted passage"
      className={className}
    >
      <defs>
        <linearGradient id="ao-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#040D15" />
          <stop offset="55%" stopColor="#07182A" />
          <stop offset="100%" stopColor="#0B2233" />
        </linearGradient>
        <linearGradient id="ao-sea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#12354A" />
          <stop offset="38%" stopColor="#0D283C" />
          <stop offset="100%" stopColor="#061421" />
        </linearGradient>
        <linearGradient id="ao-ice" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#E9ECEF" />
          <stop offset="48%" stopColor="#C7E1F0" />
          <stop offset="100%" stopColor="#7FAECA" />
        </linearGradient>
        <linearGradient id="ao-ice-shade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#9CC3DC" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#3C6C8A" stopOpacity="0.25" />
        </linearGradient>
        <radialGradient id="ao-horizon" cx="34%" cy="50%" r="58%">
          <stop offset="0%" stopColor="#A8CFE6" stopOpacity="0.42" />
          <stop offset="55%" stopColor="#51809B" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#51809B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ao-lamp" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#E9ECEF" stopOpacity="0.6" />
          <stop offset="45%" stopColor="#C7E1F0" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#C7E1F0" stopOpacity="0" />
        </radialGradient>
        <filter id="ao-soft" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
        <filter id="ao-haze" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <filter id="ao-route-glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="ao-frame">
          <rect x="0" y="0" width="1200" height="760" />
        </clipPath>
      </defs>

      <g clipPath="url(#ao-frame)">
        {/* ------------------------------------------------ sky + water */}
        <rect x="0" y="0" width="1200" height="316" fill="url(#ao-sky)" />
        <rect x="0" y="312" width="1200" height="448" fill="url(#ao-sea)" />

        {/* Polar twilight: a low sun and a restrained aurora curtain */}
        <ellipse cx="300" cy="316" rx="360" ry="150" fill="url(#ao-horizon)" filter="url(#ao-soft)" />
        <circle cx="286" cy="304" r="34" fill="url(#ao-lamp)" filter="url(#ao-haze)" />
        <circle cx="286" cy="304" r="9" fill="#E9ECEF" fillOpacity="0.75" />

        <g opacity="0.5" filter="url(#ao-haze)">
          <path
            d="M 470 40 C 560 96 620 66 706 116 C 780 158 842 132 926 172 L 926 148 C 842 108 780 134 706 92 C 620 42 560 74 470 18 Z"
            fill="#7FB4D4"
            fillOpacity="0.3"
          />
          <path
            d="M 540 96 C 620 148 676 124 748 166 C 812 204 866 186 940 218 L 940 200 C 866 168 812 186 748 148 C 676 106 620 130 540 78 Z"
            fill="#A8CFE6"
            fillOpacity="0.18"
          />
        </g>

        {/* Navigation grid, faded toward the horizon */}
        <g stroke="#A8CFE6" strokeOpacity="0.08" strokeWidth="1">
          {Array.from({ length: 13 }, (_, i) => (
            <line key={`v${i}`} x1={i * 100} y1="312" x2={i * 100 - 60} y2="760" />
          ))}
          {Array.from({ length: 5 }, (_, i) => (
            <line key={`h${i}`} x1="0" y1={316 + i * 44} x2="1200" y2={316 + i * 44} />
          ))}
        </g>

        {/* Horizon haze */}
        <rect x="0" y="306" width="1200" height="26" fill="#12354A" fillOpacity="0.5" filter="url(#ao-haze)" />

        {/* ------------------------------------------------ distant bergs */}
        <g fill="#C7E1F0" fillOpacity="0.5" filter="url(#ao-haze)">
          {BERGS.map(([x, y, w, h]) => (
            <path
              key={`${x}-${y}`}
              d={`M ${x - w} ${y} L ${x - w * 0.3} ${y - h} L ${x + w * 0.25} ${y - h * 0.72} L ${x + w} ${y} Z`}
            />
          ))}
        </g>

        {/* ------------------------------------------------ open water */}
        <g fill="none" stroke="#7FB4D4" strokeLinecap="round">
          {WAVE_ROWS.map((y, i) => (
            <path
              key={y}
              d={swell(y, 7 + (i % 4) * 3, i % 3)}
              strokeOpacity={0.05 + (i % 5) * 0.022}
              strokeWidth={i % 3 === 0 ? 1.4 : 1}
            />
          ))}
        </g>

        {/* Current / drift traces - illustrative flow language, not data */}
        <g fill="none" stroke="#A8CFE6" strokeOpacity="0.3" strokeWidth="1.6" strokeDasharray="14 12">
          <path d="M -30 470 C 180 440 340 486 540 452 C 742 418 880 446 1120 410" />
          <path d="M -30 556 C 200 524 386 566 596 528 C 812 490 946 520 1230 478" strokeOpacity="0.22" />
          <path d="M -30 652 C 220 616 430 656 660 616 C 884 578 1024 604 1230 566" strokeOpacity="0.16" />
        </g>

        {/* ------------------------------------------------ ice floes */}
        <g>
          {FLOES.map(([cx, cy, rx, ry, rot]) => (
            <g key={`${cx}-${cy}`} transform={`rotate(${rot} ${cx} ${cy})`}>
              <ellipse cx={cx} cy={cy + 4} rx={rx} ry={ry} fill="#040D15" fillOpacity="0.35" />
              <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="url(#ao-ice)" fillOpacity="0.88" />
              <path
                d={`M ${cx - rx * 0.55} ${cy - ry * 0.2} L ${cx + rx * 0.5} ${cy - ry * 0.42}`}
                stroke="#E9ECEF"
                strokeOpacity="0.7"
                strokeWidth="1.2"
                fill="none"
              />
            </g>
          ))}
        </g>

        {/* ------------------------------------------------ ice shelf */}
        <path d={SHELF} fill="url(#ao-ice)" fillOpacity="0.92" />
        <path d={SHELF} fill="url(#ao-ice-shade)" />
        <g fill="none" stroke="#5E8DAA" strokeOpacity="0.4" strokeWidth="1.2">
          {CONTOURS.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <path d={SHELF_EDGE} fill="none" stroke="#E9ECEF" strokeOpacity="0.85" strokeWidth="2.4" />
        <path
          d={SHELF_EDGE}
          fill="none"
          stroke="#51809B"
          strokeOpacity="0.5"
          strokeWidth="6"
          transform="translate(0 10)"
        />

        {/* Calved bergy bits along the shelf front */}
        <g fill="#C7E1F0" fillOpacity="0.85">
          <path d="M 792 690 l 22 -12 l 20 14 l -14 12 Z" />
          <path d="M 866 646 l 18 -10 l 16 12 l -12 10 Z" />
          <path d="M 962 578 l 20 -11 l 18 13 l -13 11 Z" />
          <path d="M 1074 536 l 16 -9 l 15 11 l -11 9 Z" />
        </g>

        {/* ------------------------------------------------ passage */}
        <path d={PASSAGE} fill="none" stroke="#040D15" strokeOpacity="0.55" strokeWidth="8" strokeLinecap="round" />
        <path
          d={PASSAGE}
          fill="none"
          stroke="#A8CFE6"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray="12 9"
          filter="url(#ao-route-glow)"
        />
        {WAYPOINTS.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="8" fill="#040D15" stroke="#A8CFE6" strokeWidth="2" />
            <circle cx={x} cy={y} r="2.6" fill="#E9ECEF" />
          </g>
        ))}

        {/* ------------------------------------------------ atmosphere */}
        <rect x="0" y="0" width="1200" height="760" fill="#040D15" fillOpacity="0.14" />
        <rect x="0" y="0" width="240" height="760" fill="#040D15" fillOpacity="0.42" />
        <rect x="0" y="640" width="1200" height="120" fill="#040D15" fillOpacity="0.34" />

        <text
          x="34"
          y="736"
          fill="#8AA6B8"
          fontFamily="ui-monospace, monospace"
          fontSize="11"
          letterSpacing="2.4"
        >
          ORIGINAL ILLUSTRATION · SOUTHERN OCEAN · NOT A CHART
        </text>
      </g>
    </svg>
  )
}
