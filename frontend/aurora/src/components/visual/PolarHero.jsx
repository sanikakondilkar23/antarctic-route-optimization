/**
 * PolarHero - the original Antarctic visual used on the AURORA landing page.
 *
 * This is a hand-authored SVG schematic: polar range rings, bearing spokes, an
 * abstract ice-shelf silhouette and a plotted route. It is deliberately not a
 * map of anything real, carries its own "schematic" caption, and contains no
 * traced or third-party artwork. Nothing in it is data: every measured value
 * the product shows comes from the AURORA API.
 */

const SPOKES = Array.from({ length: 24 }, (_, i) => i * 15)
const RINGS = [70, 132, 194, 256, 312]

const SHELF =
  'M 320 96 C 386 100 448 140 476 202 C 502 258 496 316 466 366 ' +
  'C 438 414 438 470 396 508 C 352 548 286 556 234 526 ' +
  'C 184 496 158 442 158 384 C 158 320 140 262 168 208 ' +
  'C 198 150 254 96 320 96 Z'

const INNER =
  'M 322 176 C 372 180 414 210 428 258 C 442 306 424 350 392 384 ' +
  'C 360 418 306 430 264 406 C 222 382 204 336 210 290 ' +
  'C 216 240 268 172 322 176 Z'

const ROUTE =
  'M 74 546 C 168 506 208 448 268 424 C 330 400 372 356 414 306 ' +
  'C 456 256 508 214 574 176'

const WAYPOINTS = [
  [74, 546],
  [268, 424],
  [414, 306],
  [574, 176],
]

export default function PolarHero({ className = '' }) {
  return (
    <svg
      viewBox="0 0 640 640"
      role="img"
      aria-label="Schematic polar navigation plot used as AURORA's emblem"
      className={className}
    >
      <defs>
        <radialGradient id="ph-ocean" cx="50%" cy="46%" r="62%">
          <stop offset="0%" stopColor="#12354A" />
          <stop offset="62%" stopColor="#0B2233" />
          <stop offset="100%" stopColor="#040D15" />
        </radialGradient>
        <linearGradient id="ph-shelf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#E9ECEF" />
          <stop offset="55%" stopColor="#C7E1F0" />
          <stop offset="100%" stopColor="#8FBBD6" />
        </linearGradient>
        <linearGradient id="ph-aurora" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#51809B" stopOpacity="0" />
          <stop offset="35%" stopColor="#7FB4D4" stopOpacity="0.55" />
          <stop offset="68%" stopColor="#A8CFE6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7FB4D4" stopOpacity="0" />
        </linearGradient>
        <filter id="ph-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="ph-clip">
          <circle cx="320" cy="320" r="318" />
        </clipPath>
      </defs>

      {/* Ocean disc */}
      <circle cx="320" cy="320" r="318" fill="url(#ph-ocean)" />
      <circle cx="320" cy="320" r="318" fill="none" stroke="#153A51" strokeWidth="2" />

      <g clipPath="url(#ph-clip)">
        {/* Aurora band */}
        <rect x="-40" y="52" width="720" height="86" fill="url(#ph-aurora)" />
        <rect x="-40" y="140" width="720" height="34" fill="url(#ph-aurora)" opacity="0.5" />

        {/* Bearing spokes */}
        <g stroke="#7FB4D4" strokeOpacity="0.16" strokeWidth="1">
          {SPOKES.map((deg) => (
            <line
              key={deg}
              x1="320"
              y1="320"
              x2={320 + 320 * Math.cos((deg * Math.PI) / 180)}
              y2={320 + 320 * Math.sin((deg * Math.PI) / 180)}
            />
          ))}
        </g>

        {/* Range rings */}
        <g fill="none" stroke="#A8CFE6" strokeOpacity="0.22" strokeWidth="1">
          {RINGS.map((r) => (
            <circle key={r} cx="320" cy="320" r={r} />
          ))}
        </g>
        <circle cx="320" cy="320" r="312" fill="none" stroke="#A8CFE6" strokeOpacity="0.35" strokeDasharray="3 7" />

        {/* Abstract ice shelf — schematic, not geography */}
        <path d={SHELF} fill="url(#ph-shelf)" fillOpacity="0.14" stroke="#C7E1F0" strokeOpacity="0.7" strokeWidth="1.6" />
        <path
          d={SHELF}
          fill="none"
          stroke="#7FB4D4"
          strokeOpacity="0.35"
          strokeWidth="1"
          transform="translate(320 320) scale(1.075) translate(-320 -320)"
        />
        <path
          d={SHELF}
          fill="none"
          stroke="#7FB4D4"
          strokeOpacity="0.2"
          strokeWidth="1"
          transform="translate(320 320) scale(1.15) translate(-320 -320)"
        />
        <path d={INNER} fill="#E9ECEF" fillOpacity="0.1" stroke="#E9ECEF" strokeOpacity="0.5" strokeWidth="1.2" />

        {/* Plotted route */}
        <path d={ROUTE} fill="none" stroke="#040D15" strokeOpacity="0.8" strokeWidth="7" strokeLinecap="round" />
        <path
          d={ROUTE}
          fill="none"
          stroke="#7FB4D4"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray="9 6"
          filter="url(#ph-glow)"
        />
        {WAYPOINTS.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="7" fill="#040D15" stroke="#A8CFE6" strokeWidth="2" />
            <circle cx={x} cy={y} r="2.4" fill="#E9ECEF" />
          </g>
        ))}

        {/* Ice floes — pure ornament */}
        <g fill="#A8CFE6" fillOpacity="0.28">
          <ellipse cx="150" cy="150" rx="16" ry="7" transform="rotate(-18 150 150)" />
          <ellipse cx="516" cy="452" rx="21" ry="8" transform="rotate(12 516 452)" />
          <ellipse cx="558" cy="330" rx="12" ry="6" transform="rotate(-8 558 330)" />
          <ellipse cx="118" cy="392" rx="14" ry="6" transform="rotate(22 118 392)" />
          <ellipse cx="452" cy="128" rx="10" ry="5" transform="rotate(-30 452 128)" />
        </g>
      </g>

      {/* Tick labels on the frame */}
      <g fill="#6E7881" fontFamily="ui-monospace, monospace" fontSize="11" letterSpacing="1.4">
        <text x="320" y="34" textAnchor="middle">000</text>
        <text x="612" y="324" textAnchor="end">090</text>
        <text x="320" y="622" textAnchor="middle">180</text>
        <text x="28" y="324" textAnchor="start">270</text>
      </g>

      <text
        x="320"
        y="600"
        textAnchor="middle"
        fill="#6E7881"
        fontFamily="ui-monospace, monospace"
        fontSize="10"
        letterSpacing="2.4"
      >
        SCHEMATIC · NOT TO SCALE · NOT A CHART
      </text>
    </svg>
  )
}
