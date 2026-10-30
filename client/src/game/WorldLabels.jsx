import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { CRYSTAL_BY_ID, crystalScale, MUTATIONS, RARITIES, SIZES } from '@shared/catalog.js'
import { kg, luckPct, money, shortNumber } from '@shared/format.js'
import { net, useNet } from '../net/net'
import { quality } from '../store/quality'
import { crystalBaseY } from './crystals/crystalMath'
import { FLOAT_LIFE, floats } from './effects/fxBus'
import { nearestLoose } from './interaction'
import { localPlayer } from './localPlayer'
import { groundHeight } from './world/ground'

/**
 * Floating labels (name tags, crystal info, HP bars, "E PICK UP") as a pool of DOM
 * elements positioned from the frame loop. No React state per frame: candidates are
 * chosen into fixed arrays, and an element's HTML is rewritten only when what it
 * shows actually changes.
 */
export const labelLayer = { el: null }

const POOL = 16
/** Frames between label re-scans (4 = 15 times a second at 60 fps). */
const RESCAN = 4
const NAME_RANGE = 70
const CRYSTAL_RANGE = 15
const _v = new Vector3()

/** Phones and short windows: fewer, smaller labels (the same rule as the compact HUD). */
const compactView =
  typeof window !== 'undefined' ? window.matchMedia('(max-height: 560px), (max-width: 720px)') : { matches: false }

/**
 * How many labels of each kind may show at once, so they never pile up over what
 * you're doing: a full card only for the crystal you can pick up, one HP bar (the
 * crystal you're mining), a few garden cards, a few names.
 */
function labelCaps() {
  return compactView.matches
    ? { players: 3, buried: 1, looseTags: 0, garden: 1 }
    : { players: 6, buried: 1, looseTags: 2, garden: 3 }
}

/** Candidate buffers (kind: 1 player, 2 world crystal, 3 garden crystal). */
const cand = {
  n: 0,
  kind: new Uint8Array(64),
  d2: new Float32Array(64),
  x: new Float32Array(64),
  y: new Float32Array(64),
  z: new Float32Array(64),
  ref: new Array(64),
  id: new Array(64),
}

const CAND_ARRAYS = [cand.kind, cand.d2, cand.x, cand.y, cand.z, cand.ref, cand.id]

function push(kind, d2, x, y, z, ref, id) {
  if (cand.n >= 64) return
  const i = cand.n++
  cand.kind[i] = kind
  cand.d2[i] = d2
  cand.x[i] = x
  cand.y[i] = y
  cand.z[i] = z
  cand.ref[i] = ref
  cand.id[i] = id
}

/** Your backpack's load right now: [carried kg, capacity kg]. */
function bagLoad() {
  const me = useNet.getState().me
  if (!me) return [0, 0]
  let w = 0
  for (const it of me.backpack) w += it.weight
  return [w, me.backpackCap]
}

/** The pick-up prompt: the key and the weight, or BAG FULL when it won't fit. */
function promptHtml(c) {
  const [load, cap] = bagLoad()
  if (load + c.weight > cap + 1e-6) {
    return `<div class="lbl-prompt full"><span class="key">E</span> BAG FULL <span class="lbl-load">${kg(load)} / ${kg(cap)}</span></div>`
  }
  return `<div class="lbl-prompt"><span class="key">E</span> PICK UP <span class="lbl-weight">+${kg(c.weight)}</span></div>`
}

function crystalHtml(c, { full, prompt, garden, brief }) {
  const type = CRYSTAL_BY_ID[c.type]
  if (!type) return ''
  const rarity = RARITIES[type.rarity]
  if (!full) {
    // Still in the wall: what it is and how heavy, over its HP bar.
    const pct = Math.max(0, Math.min(1, c.hp / c.maxHp))
    const color = pct > 0.5 ? '#4cd964' : pct > 0.2 ? '#ffb020' : '#ff3b30'
    return `<div class="lbl-hp"><div class="lbl-hp-what"><span style="color:${rarity.color}">${SIZES[c.size]?.name ?? ''} ${type.name}</span> · ${kg(c.weight)}</div><div class="lbl-hp-num">${shortNumber(Math.ceil(c.hp))} / ${shortNumber(c.maxHp)}</div><div class="lbl-hp-bar"><div style="width:${pct * 100}%;background:${color}"></div></div></div>`
  }
  if (brief) {
    // Other loose crystals nearby: one line, so the one you're picking up stands out.
    return `<div class="lbl-tag"><span style="color:${rarity.color}">${type.name}</span> · ${kg(c.weight)}</div>`
  }
  const mut = c.mutation ? `<div class="lbl-mut" style="color:${MUTATIONS[c.mutation]?.color}">${c.mutation}</div>` : ''
  const owner = c.ownerName && c.owner !== net.room?.sessionId && !garden ? `<div class="lbl-owner">${c.ownerName}'s</div>` : ''
  // Luck only matters for garden crystals (it's what they give you).
  const luck = garden ? `<div class="lbl-luck">Luck: ${luckPct(c.luck ?? 0)}</div>` : ''
  return `<div class="lbl-crystal${garden ? ' small' : ''}">
    <div class="lbl-name">${type.name}</div>
    <div><span style="color:${rarity.color}">${rarity.name}</span> · ${SIZES[c.size]?.name ?? ''} · ${kg(c.weight)}</div>
    <div class="lbl-val">${money(c.value)}</div>
    ${luck}${mut}${owner}
  </div>${prompt ? promptHtml(c) : ''}`
}

export function LabelDriver() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const pool = useRef(null)

  useEffect(() => {
    const host = labelLayer.el
    if (!host) return undefined
    const items = []
    for (let i = 0; i < POOL; i += 1) {
      const el = document.createElement('div')
      el.className = 'world-label'
      el.style.display = 'none'
      host.appendChild(el)
      items.push({ el, key: '', shown: false })
    }
    pool.current = items
    return () => {
      items.forEach((it) => it.el.remove())
      pool.current = null
    }
  }, [])

  /** Frame counter: candidates are re-scanned every RESCAN frames, moved every frame. */
  const tick = useRef(0)
  const shownCount = useRef(0)

  useFrame(() => {
    const items = pool.current
    const room = net.room
    if (!items) return

    // --- Re-scan (15x a second): who gets a label, and what it says --------------
    if (tick.current++ % RESCAN === 0) {
      cand.n = 0
      // Right after joining, the state's collections may not all be decoded yet.
      if (room?.state?.players && room.state.crystals) {
        const me = room.sessionId
        room.state.players.forEach((p, id) => {
          if (id === me) return
          const dx = p.x - localPlayer.x
          const dz = p.z - localPlayer.z
          const d2 = dx * dx + dz * dz
          if (d2 < NAME_RANGE * NAME_RANGE) push(1, d2 * 0.5, p.x, p.y + 2.35, p.z, p, id)
        })
        room.state.crystals.forEach((c, id) => {
          const dx = c.x - localPlayer.x
          const dz = c.z - localPlayer.z
          const d2 = dx * dx + dz * dz
          if (d2 > CRYSTAL_RANGE * CRYSTAL_RANGE) return
          // Buried crystals only get a label once someone has started mining them.
          if (c.state === 0 && c.hp >= c.maxHp) return
          const s = crystalScale(c.weight)
          push(2, d2, c.x, crystalBaseY(c) + s * (c.state === 0 ? 0.9 : 1.25) + 0.3, c.z, c, id)
        })
        room.state.players.forEach((p) => {
          p.garden?.forEach((it) => {
            const dx = it.x - localPlayer.x
            const dz = it.z - localPlayer.z
            const d2 = dx * dx + dz * dz
            if (d2 < 11 * 11) {
              push(3, d2 + 4, it.x, groundHeight(it.x, it.z) + crystalScale(it.weight) * 1.05 + 0.25, it.z, it, it.uid)
            }
          })
        })
      }

      // Closest first (selection sort, n <= 64), then each kind up to its cap.
      for (let i = 0; i < cand.n; i += 1) {
        let best = i
        for (let j = i + 1; j < cand.n; j += 1) if (cand.d2[j] < cand.d2[best]) best = j
        if (best !== i) {
          for (const arr of CAND_ARRAYS) {
            const t = arr[i]
            arr[i] = arr[best]
            arr[best] = t
          }
        }
      }
      const limit = Math.min(POOL, quality().labels + 5)
      const caps = labelCaps()
      const left = { 1: caps.players, buried: caps.buried, loose: caps.looseTags, 3: caps.garden }
      const pickup = nearestLoose(5)
      let used = 0
      for (let i = 0; i < cand.n && used < limit; i += 1) {
        const kind = cand.kind[i]
        const ref = cand.ref[i]
        const prompt = kind === 2 && !!(pickup && pickup.id === cand.id[i] && pickup.mine)
        // The crystal you can pick up always gets its card; everything else is capped.
        const bucket = kind === 2 ? (ref.state === 0 ? 'buried' : 'loose') : kind
        if (!prompt) {
          if (left[bucket] <= 0) continue
          left[bucket] -= 1
        }
        if (i !== used) {
          for (const arr of CAND_ARRAYS) {
            const t = arr[used]
            arr[used] = arr[i]
            arr[i] = t
          }
        }
        const item = items[used]
        const brief = kind === 2 && ref.state === 1 && !prompt
        let key
        if (kind === 1) key = `p${cand.id[used]}${ref.name}`
        else if (kind === 2) {
          key = `c${cand.id[used]}${ref.state}${Math.ceil(ref.hp)}${brief ? 'b' : ''}${prompt ? `P${bagLoad()[0].toFixed(1)}/${bagLoad()[1]}` : ''}${ref.owner}`
        } else key = `g${cand.id[used]}`
        if (item.key !== key) {
          item.key = key
          if (kind === 1) item.el.innerHTML = `<div class="lbl-player">${ref.name}</div>`
          else if (kind === 2) item.el.innerHTML = crystalHtml(ref, { full: ref.state === 1, prompt, brief })
          else item.el.innerHTML = crystalHtml(ref, { full: true, garden: true })
        }
        used += 1
      }
      for (let i = used; i < POOL; i += 1) {
        if (items[i].shown) {
          items[i].el.style.display = 'none'
          items[i].shown = false
        }
      }
      shownCount.current = used
    }

    // --- Every frame: just move the labels with the camera ------------------------
    for (let i = 0; i < shownCount.current; i += 1) {
      const item = items[i]
      _v.set(cand.x[i], cand.y[i], cand.z[i]).project(camera)
      if (_v.z > 1 || _v.x < -1.2 || _v.x > 1.2 || _v.y < -1.2 || _v.y > 1.2) {
        if (item.shown) {
          item.el.style.display = 'none'
          item.shown = false
        }
        continue
      }
      const px = (_v.x * 0.5 + 0.5) * size.width
      const py = (-_v.y * 0.5 + 0.5) * size.height
      const scale = Math.max(0.5, Math.min(1.05, 11 / (Math.sqrt(cand.d2[i]) + 4)))
      item.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`
      if (!item.shown) {
        item.el.style.display = ''
        item.shown = true
      }
    }
  })

  return null
}

/**
 * Damage numbers and "+$120" popups: a fixed pool of DOM nodes that rise and fade.
 * Text is written only when a slot is respawned.
 */
export function FloatTextDriver() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const nodes = useRef(null)

  useEffect(() => {
    const host = labelLayer.el
    if (!host) return undefined
    const list = floats.map(() => {
      const el = document.createElement('div')
      el.className = 'float-text'
      el.style.display = 'none'
      host.appendChild(el)
      return el
    })
    nodes.current = list
    return () => {
      list.forEach((el) => el.remove())
      nodes.current = null
    }
  }, [])

  useFrame((_s, delta) => {
    const list = nodes.current
    if (!list) return
    for (let i = 0; i < floats.length; i += 1) {
      const f = floats[i]
      const el = list[i]
      if (f.t < 0) continue
      if (f.dirty) {
        f.dirty = false
        el.textContent = f.text
        el.style.color = f.color
        el.style.fontSize = f.big ? '30px' : '22px'
      }
      f.t += delta
      const k = f.t / FLOAT_LIFE
      if (k >= 1) {
        f.t = -1
        el.style.display = 'none'
        continue
      }
      _v.set(f.x, f.y + k * 1.6, f.z).project(camera)
      if (_v.z > 1) {
        el.style.display = 'none'
        continue
      }
      const px = (_v.x * 0.5 + 0.5) * size.width
      const py = (-_v.y * 0.5 + 0.5) * size.height
      // Pop in, then drift up and fade.
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.5)
      el.style.display = ''
      el.style.opacity = String(k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1)
      el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`
    }
  })

  return null
}
