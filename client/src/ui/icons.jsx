import { BOMB_BY_ID, CRYSTAL_BY_ID, MUTATIONS, PICKAXE_BY_ID, RADAR_BY_ID } from '@shared/catalog.js'

import { pickaxeStyle } from '../game/avatar/pickaxeStyles'

/** Inline SVG icons: zero image requests, recolourable per item. */

export function CoinIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <circle cx="20" cy="20" r="18" fill="#f5a512" stroke="#7a4a05" strokeWidth="3" />
      <circle cx="20" cy="20" r="12.5" fill="#ffcf3d" />
      <text x="20" y="27" textAnchor="middle" fontSize="19" fontWeight="900" fill="#c97a06">
        $
      </text>
    </svg>
  )
}

export function CandyIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <path d="M20 2 L35 36 Q20 40 5 36 Z" fill="#fff6e0" stroke="#3a2a10" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M11.6 21 L28.4 21 L35 36 Q20 40 5 36 Z" fill="#ff8a1e" />
      <path d="M7.6 30 L32.4 30 L35 36 Q20 40 5 36 Z" fill="#ffd23a" />
      <path d="M20 2 L35 36 Q20 40 5 36 Z" fill="none" stroke="#3a2a10" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  )
}

export function CloverIcon({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {[0, 90, 180, 270].map((a) => (
        <g key={a} transform={`rotate(${a} 24 22)`}>
          <circle cx="18" cy="14" r="8" fill="#3fd23f" stroke="#145c14" strokeWidth="2" />
          <circle cx="30" cy="14" r="8" fill="#3fd23f" stroke="#145c14" strokeWidth="2" />
        </g>
      ))}
      <circle cx="24" cy="22" r="5" fill="#2bb52b" />
      <path d="M24 26 Q26 38 20 46" stroke="#145c14" strokeWidth="3" fill="none" />
    </svg>
  )
}

export function CloudIcon({ size = 64 }) {
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 64 40">
      <path
        d="M14 36 Q2 36 3 26 Q4 17 14 18 Q15 6 28 6 Q38 6 41 15 Q46 9 53 13 Q61 18 58 26 Q63 36 52 36 Z"
        fill="#fff"
        stroke="#2a3140"
        strokeWidth="2.5"
      />
      <path d="M10 30 Q30 34 56 30" stroke="#d6e2f0" strokeWidth="3" fill="none" />
    </svg>
  )
}

export function SnowflakeIcon({ size = 26, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" stroke={color} strokeWidth="2.4" strokeLinecap="round">
      {[0, 60, 120].map((a) => (
        <g key={a} transform={`rotate(${a} 13 13)`}>
          <line x1="13" y1="2" x2="13" y2="24" />
          <line x1="13" y1="6" x2="10" y2="3.5" />
          <line x1="13" y1="6" x2="16" y2="3.5" />
          <line x1="13" y1="20" x2="10" y2="22.5" />
          <line x1="13" y1="20" x2="16" y2="22.5" />
        </g>
      ))}
    </svg>
  )
}

/**
 * Pickaxe icon drawn from the same style table as the 3D model: shaded shaft with a
 * wrapped grip, a curved bevelled head (or blade, or crystal shards), collar gem,
 * and sparkles + glow on the rare ones.
 */
export function PickaxeIcon({ id = 'rusted', size = 48 }) {
  const def = PICKAXE_BY_ID[id] ?? PICKAXE_BY_ID.rusted
  const st = pickaxeStyle(def.id)
  const uid = `px-${def.id}`
  const OUT = '#141824'
  const glow = st.glow && def.rarity >= 3
  // Head geometry in a 48-unit box: shaft from bottom-left to the collar at (31, 15).
  const pick = 'M12 16 Q22 5 31 10 Q40 15 45 27 Q37 19 31 19 Q24 18 12 16 Z'
  const adze = 'M14 14 Q22 6 31 10 L36 13 Q41 17 41 26 L33 22 Q28 18 22 18 Q17 17 14 14 Z'
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={glow ? { filter: `drop-shadow(0 0 3px ${st.glow})` } : undefined}>
      <defs>
        <linearGradient id={`${uid}-h`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={st.edge} />
          <stop offset="0.45" stopColor={st.head} />
          <stop offset="1" stopColor={st.head} stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id={`${uid}-s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={st.handle} />
          <stop offset="1" stopColor={st.grip} />
        </linearGradient>
      </defs>

      {/* Shaft, outlined, with a highlight */}
      <line x1="9" y1="43" x2="31" y2="15" stroke={OUT} strokeWidth="7.5" strokeLinecap="round" />
      <line x1="9" y1="43" x2="31" y2="15" stroke={st.handle} strokeWidth="4.5" strokeLinecap="round" />
      <line x1="10" y1="40.5" x2="29" y2="16.5" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.2" strokeLinecap="round" />
      {/* Wrapped grip */}
      {[0, 1, 2].map((k) => (
        <line
          key={k}
          x1={10.5 + k * 2.6}
          y1={38 - k * 3.3}
          x2={14.5 + k * 2.6}
          y2={41.5 - k * 3.3}
          stroke={st.grip}
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      ))}
      <circle cx="8.6" cy="43.4" r="2.6" fill={def.rarity >= 2 ? st.collar : st.grip} stroke={OUT} strokeWidth="1.5" />

      {/* Head */}
      {st.shape === 'crystal' ? (
        <g stroke={OUT} strokeWidth="1.8" strokeLinejoin="round">
          <path d="M31 13 L22 6 L17 13 L25 17 Z" fill={st.head} />
          <path d="M31 13 L42 9 L45 22 L36 19 Z" fill={st.edge} />
          <path d="M25 14 L19 3 L27 9 Z" fill={st.edge} />
          <path d="M37 15 L46 14 L41 25 Z" fill={st.head} />
        </g>
      ) : (
        <path d={st.shape === 'adze' ? adze : pick} fill={`url(#${uid}-h)`} stroke={OUT} strokeWidth="2.4" strokeLinejoin="round" />
      )}
      {st.shape !== 'crystal' && (
        <path d="M14 14.5 Q22 7 31 11 Q38 14 43 23" fill="none" stroke={st.edge} strokeWidth="1.3" strokeLinecap="round" opacity="0.9" />
      )}
      {/* Collar and gem */}
      <rect x="27.5" y="10.5" width="7" height="7.5" rx="1.6" fill={st.collar} stroke={OUT} strokeWidth="1.8" transform="rotate(-38 31 14)" />
      {st.gem && <path d="M31 11.2 L33.4 14 L31 16.8 L28.6 14 Z" fill={st.gem} stroke={OUT} strokeWidth="0.9" />}

      {/* Sparkles on the rare ones */}
      {def.rarity >= 3 &&
        [
          [41, 6, 2.6],
          [6, 22, 1.8],
          [24, 30, 1.4],
        ].map(([x, y, r]) => (
          <path
            key={`${x}${y}`}
            d={`M${x} ${y - r * 1.6} L${x + r * 0.4} ${y - r * 0.4} L${x + r * 1.6} ${y} L${x + r * 0.4} ${y + r * 0.4} L${x} ${y + r * 1.6} L${x - r * 0.4} ${y + r * 0.4} L${x - r * 1.6} ${y} L${x - r * 0.4} ${y - r * 0.4} Z`}
            fill={st.glow ?? '#fff'}
            className="twinkle"
            style={{ animationDelay: `${(x % 7) * 0.2}s` }}
          />
        ))}
    </svg>
  )
}

export function GemIcon({ color = '#7fe6ff', size = 44, mutation }) {
  const stroke = mutation ? MUTATIONS[mutation]?.color ?? '#1a1a1a' : '#1a1a1a'
  return (
    <svg width={size} height={size} viewBox="0 0 44 44">
      <path d="M22 3 L31 14 L27 40 L17 40 L13 14 Z" fill={color} stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M13 14 L4 20 L10 40 L17 40 Z" fill={color} opacity="0.75" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      <path d="M31 14 L40 22 L34 40 L27 40 Z" fill={color} opacity="0.6" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      <path d="M22 3 L22 40" stroke="#fff" strokeOpacity="0.45" strokeWidth="2" />
    </svg>
  )
}

export function BombIcon({ color = '#2a2d3a', size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44">
      <circle cx="20" cy="26" r="15" fill={color} stroke="#111" strokeWidth="2.5" />
      <circle cx="15" cy="20" r="4" fill="#fff" opacity="0.4" />
      <rect x="25" y="7" width="8" height="8" rx="2" fill="#666" stroke="#111" strokeWidth="2" transform="rotate(35 29 11)" />
      <path d="M32 8 Q38 2 40 6" stroke="#c9a36a" strokeWidth="2.5" fill="none" />
      <circle cx="40" cy="6" r="3" fill="#ffb020" />
    </svg>
  )
}

export function RadarIcon({ color = '#e6e9f0', size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44">
      <rect x="5" y="9" width="32" height="30" rx="7" fill={color} stroke="#111" strokeWidth="2.5" />
      <circle cx="23" cy="24" r="10" fill="#14161e" />
      <circle cx="23" cy="24" r="6" fill="none" stroke="#3df2ff" strokeWidth="1.5" />
      <circle cx="23" cy="24" r="2.5" fill="#3df2ff" />
      <path d="M30 9 Q33 2 38 4" stroke="#111" strokeWidth="2.5" fill="none" />
    </svg>
  )
}

/** Icon for any backpack item. */
export function ItemIcon({ item, size = 44 }) {
  if (!item) return null
  if (item.kind === 'bomb') return <BombIcon color={BOMB_BY_ID[item.type]?.color} size={size} />
  if (item.kind === 'radar') return <RadarIcon color={RADAR_BY_ID[item.type]?.color} size={size} />
  return <GemIcon color={CRYSTAL_BY_ID[item.type]?.color} mutation={item.mutation} size={size} />
}

export function HomeIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <path d="M4 20 L20 5 L36 20" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 18 V35 H31 V18" stroke="#fff" strokeWidth="5" fill="none" strokeLinejoin="round" />
      <rect x="17" y="24" width="6" height="11" fill="#fff" />
    </svg>
  )
}

export function BasketIcon({ size = 54 }) {
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 54 44">
      <path d="M14 18 L22 4 M40 18 L32 4" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <path d="M3 18 H51 L46 40 H8 Z" fill="#fff" stroke="#111" strokeWidth="2.5" strokeLinejoin="round" />
      {[16, 24, 32, 40].map((x) => (
        <line key={x} x1={x} y1="24" x2={x - 1} y2="35" stroke="#111" strokeWidth="3" strokeLinecap="round" />
      ))}
    </svg>
  )
}

export function ClipboardIcon({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 44">
      <rect x="7" y="6" width="30" height="35" rx="4" fill="#fff" stroke="#111" strokeWidth="2.5" />
      <rect x="15" y="2" width="14" height="8" rx="2" fill="#fff" stroke="#111" strokeWidth="2.5" />
      {[17, 24, 31].map((y) => (
        <line key={y} x1="13" y1={y} x2="31" y2={y} stroke="#111" strokeWidth="3" strokeLinecap="round" />
      ))}
    </svg>
  )
}

export function TicketIcon({ size = 54 }) {
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 54 40">
      <path
        d="M4 8 H50 V16 Q45 20 50 24 V32 H4 V24 Q9 20 4 16 Z"
        fill="#fff"
        stroke="#111"
        strokeWidth="2.5"
        transform="rotate(-8 27 20)"
      />
      <g transform="translate(27 20) rotate(-8)">
        <SnowflakeGlyph />
      </g>
    </svg>
  )
}

function SnowflakeGlyph() {
  return (
    <g stroke="#111" strokeWidth="2" strokeLinecap="round">
      {[0, 60, 120].map((a) => (
        <line key={a} x1="0" y1="-8" x2="0" y2="8" transform={`rotate(${a})`} />
      ))}
    </g>
  )
}

/**
 * HUD menu glyphs: one consistent two-tone set (white body, ice-blue / gold accents)
 * on a 24-unit grid, so every button in the HUD reads as part of the same family.
 */
const GLYPHS = {
  shop: (
    <>
      <path d="M6 8h12l-1 12.5a1.6 1.6 0 0 1-1.6 1.5H8.6A1.6 1.6 0 0 1 7 20.5Z" fill="#fff" />
      <path d="M9 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="#7fe6ff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="14.5" r="2" fill="#ffd23a" />
    </>
  ),
  index: (
    <>
      <path d="M4 5.5C6.5 4.5 9.5 4.5 12 6v14c-2.5-1.5-5.5-1.5-8-.5Z" fill="#fff" />
      <path d="M20 5.5c-2.5-1-5.5-1-8 .5v14c2.5-1.5 5.5-1.5 8-.5Z" fill="#cfefff" />
      <path d="M14.5 9.5h3M14.5 12.5h3" stroke="#3d8bd8" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  pass: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4Z" fill="#fff" />
      <path d="M12 8.3l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3Z" fill="#ffd23a" />
    </>
  ),
  event: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="1.5" fill="#fff" />
      <rect x="3" y="7" width="18" height="4" rx="1.2" fill="#cfefff" />
      <rect x="10.8" y="7" width="2.4" height="14" fill="#ff5a7a" />
      <path d="M12 7c-1.5-3-5-3.5-5-1.3S10 7 12 7c2 0 5 .9 5-1.3S13.5 4 12 7Z" fill="#ff5a7a" />
    </>
  ),
  quests: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" fill="#fff" />
      <path d="M8 8.5l1.3 1.3L11.6 7.5M8 14l1.3 1.3 2.3-2.3" fill="none" stroke="#2fbf5a" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 9h3M13.5 14.5h3" stroke="#3d8bd8" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  players: (
    <>
      <circle cx="9" cy="8" r="3.2" fill="#fff" />
      <path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0Z" fill="#fff" />
      <circle cx="16.5" cy="9" r="2.6" fill="#7fe6ff" />
      <path d="M14.8 13.6a5 5 0 0 1 6.6 4.7h-5" fill="#7fe6ff" />
    </>
  ),
  settings: (
    <>
      <path
        d="M10.4 2.8h3.2l.5 2.5 1.6.9 2.4-.9 1.6 2.8-1.9 1.7v1.8l1.9 1.7-1.6 2.8-2.4-.9-1.6.9-.5 2.5h-3.2l-.5-2.5-1.6-.9-2.4.9-1.6-2.8 1.9-1.7v-1.8L4.3 8.1l1.6-2.8 2.4.9 1.6-.9Z"
        fill="#fff"
      />
      <circle cx="12" cy="12" r="3" fill="#3d8bd8" />
    </>
  ),
  home: (
    <>
      <path d="M3.5 11.2 12 4l8.5 7.2" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10.5V20h12v-9.5L12 5.5Z" fill="#fff" />
      <rect x="10.2" y="14" width="3.6" height="6" rx="0.8" fill="#2a8a3e" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12C5 6.5 8.5 4.5 12 4.5S19 6.5 22 12c-3 5.5-6.5 7.5-10 7.5S5 17.5 2 12Z" fill="#fff" />
      <circle cx="12" cy="12" r="4.2" fill="#3d8bd8" />
      <circle cx="12" cy="12" r="1.8" fill="#0d1d33" />
      <circle cx="13.4" cy="10.6" r="0.9" fill="#fff" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="6.5" r="3.6" fill="#fff" />
      <path d="M5 21c0-5 3-8.5 7-8.5s7 3.5 7 8.5Z" fill="#fff" />
      <path d="M2.5 4.5 5.5 7.5M21.5 4.5 18.5 7.5" stroke="#7fe6ff" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="8" fill="#fff" />
      <rect x="10" y="2.5" width="4" height="2.4" rx="1" fill="#cfefff" />
      <path d="M12 13V8.8M12 13l3 1.8" stroke="#3d8bd8" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
}

export function Glyph({ name, size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  )
}
