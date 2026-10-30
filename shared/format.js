/** Number formatting matching the game's HUD: $120B, $1.15K, 1.78kt. */

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi']

export function shortNumber(n, digits = 2) {
  if (!Number.isFinite(n)) return '0'
  const sign = n < 0 ? '-' : ''
  let v = Math.abs(n)
  if (v < 1000) return sign + (Number.isInteger(v) ? String(v) : v.toFixed(1).replace(/\.0$/, ''))
  let i = 0
  while (v >= 1000 && i < SUFFIXES.length - 1) {
    v /= 1000
    i += 1
  }
  const fixed = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(Math.min(1, digits)) : v.toFixed(digits)
  return sign + fixed.replace(/\.?0+$/, '') + SUFFIXES[i]
}

export const money = (n) => `$${shortNumber(Math.round(n))}`

export function kg(w) {
  if (w >= 1000) return `${shortNumber(w / 1000)}t`
  return `${w.toFixed(1)} kg`
}

/** Luck in percent: +0.2%, +4.65K% */
export const luckPct = (p) => `+${p >= 1000 ? shortNumber(p) : p.toFixed(1)}%`

/** mm:ss countdown. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
