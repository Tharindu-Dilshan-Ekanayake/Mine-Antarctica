import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { CRYSTAL_BY_ID, MUTATIONS, RARITIES, SIZES } from '@shared/catalog.js'
import { kg } from '@shared/format.js'
import { onNetEvent } from '../net/net'
import { GemIcon } from './icons'

/**
 * Number that rolls to its new value instead of snapping, and bumps when it grows.
 * Writes the DOM directly during the tween so React renders once per change.
 */
export function AnimatedNumber({ value, format, className, style }) {
  const ref = useRef(null)
  const shown = useRef(value)

  // The span's text is owned here, never by React, so the tween can write it.
  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = format(shown.current)
  }, [format])

  useEffect(() => {
    const el = ref.current
    const from = shown.current
    const to = value
    if (from === to || !el) return undefined
    if (to > from) {
      el.classList.remove('bump')
      void el.offsetWidth // restart the CSS animation
      el.classList.add('bump')
    }
    const start = performance.now()
    const dur = Math.min(900, 250 + Math.log10(Math.abs(to - from) + 1) * 120)
    let raf
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur)
      shown.current = k >= 1 ? to : from + (to - from) * (1 - Math.pow(1 - k, 3))
      el.textContent = format(shown.current)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      shown.current = to
      el.textContent = format(to)
    }
  }, [value, format])

  return <span ref={ref} className={className} style={style} />
}

/**
 * Centre-screen celebration for a new Index entry or an Epic+ find: spinning rays,
 * the gem popping in, then fading away.
 */
export function Splash() {
  const [splash, setSplash] = useState(null)

  useEffect(() => {
    let timer
    const show = (data) => {
      clearTimeout(timer)
      setSplash({ ...data, key: Date.now() })
      timer = setTimeout(() => setSplash(null), 2600)
    }
    const offs = [
      onNetEvent('discovered', ({ type }) => show({ type, title: 'NEW CRYSTAL!' })),
      onNetEvent('found', ({ type, size, weight, mutation }) => {
        const rarity = CRYSTAL_BY_ID[type]?.rarity ?? 0
        if (rarity >= 3 || size >= 4) {
          // A rare one, or a giant: "HUGE FIND!" / "GARGANTUAN FIND!" for the big ones.
          const title = size >= 4 ? `${SIZES[size].name.toUpperCase()} FIND!` : `${RARITIES[rarity].name.toUpperCase()} FIND!`
          show({ type, size, weight, mutation, title })
        }
      }),
    ]
    return () => {
      clearTimeout(timer)
      offs.forEach((off) => off())
    }
  }, [])

  if (!splash) return null
  const type = CRYSTAL_BY_ID[splash.type]
  const rarity = RARITIES[type?.rarity ?? 0]
  return (
    <div key={splash.key} className="splash pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <div className="splash-rays" style={{ '--ray': rarity.color }} />
      <div className="splash-card flex flex-col items-center">
        <div className="cartoon text-[46px] leading-none" style={{ color: rarity.color }}>
          {splash.title}
        </div>
        <div className="splash-gem my-2">
          <GemIcon color={type?.color} mutation={splash.mutation} size={130} />
        </div>
        <div className="cartoon text-[30px] leading-none">{type?.name}</div>
        <div className="cartoon-thin mt-1 text-[18px] font-bold" style={{ color: rarity.color }}>
          {rarity.name}
          {splash.weight ? ` · ${kg(splash.weight)}` : ''}
          {splash.mutation ? <span style={{ color: MUTATIONS[splash.mutation]?.color }}> · {splash.mutation}</span> : null}
        </div>
      </div>
    </div>
  )
}

/** Falling snowflakes for the loading screen (pure CSS), laid out once. */
const FLAKES = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 13) % 50) / 10,
  dur: 5 + ((i * 7) % 6),
  size: 6 + ((i * 11) % 10),
}))

export function CssSnow() {
  return FLAKES.map((f, i) => (
    <span
      key={i}
      className="css-flake"
      style={{ left: `${f.left}%`, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s`, width: f.size, height: f.size }}
    />
  ))
}
