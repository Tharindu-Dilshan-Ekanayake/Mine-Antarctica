import { useFrame } from '@react-three/fiber'
import { memo, useMemo, useRef } from 'react'

import { SWING_TIME } from '@shared/catalog.js'
import { net, serverNow, useNet } from '../net/net'
import { quality } from '../store/quality'
import Avatar from './avatar/Avatar'
import { emptyBag, syncBag } from './avatar/bagState'
import { emoteMotion } from './emotes'
import { localPlayer } from './localPlayer'

function parseAvatar(json) {
  if (!json) return { equipped: null, proportions: undefined }
  try {
    const v = JSON.parse(json)
    return { equipped: v.equipped ?? null, proportions: v.proportions ?? undefined }
  } catch {
    return { equipped: null, proportions: undefined }
  }
}

function angleLerp(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * Another player: interpolated toward the latest server position each frame, culled
 * beyond the preset's view distance (avatars are the most expensive thing on screen).
 */
const RemotePlayer = memo(function RemotePlayer({ id, avatar, pickaxe }) {
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const motionRef = useRef({ time: 0, speed: 0, maxSpeed: 7, grounded: true, swing: -1 })
  const last = useRef({ x: 0, z: 0, init: false, anim: 0, sx: NaN, sz: NaN, st: 0, vel: 0 })
  const { equipped, proportions } = useMemo(() => parseAvatar(avatar), [avatar])
  const bagRef = useRef(null)
  if (!bagRef.current) bagRef.current = emptyBag()
  const bagTimer = useRef(0)

  useFrame((_s, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05)
    const p = net.room?.state.players.get(id)
    const g = groupRef.current
    if (!p || !g) return
    // Their backpack: refreshed twice a second, that's plenty for how full it looks.
    bagTimer.current -= dt
    if (bagTimer.current <= 0) {
      bagTimer.current = 0.5
      syncBag(bagRef.current, p.backpack, p.backpackCap)
    }

    const dx = p.x - localPlayer.x
    const dz = p.z - localPlayer.z
    const cull = quality().remoteCull
    g.visible = dx * dx + dz * dz < cull * cull

    const l = last.current
    if (!l.init) {
      g.position.set(p.x, p.y, p.z)
      l.init = true
    }
    const k = 1 - Math.exp(-12 * dt)
    g.position.x += (p.x - g.position.x) * k
    g.position.y += (p.y - g.position.y) * k
    g.position.z += (p.z - g.position.z) * k
    if (visualRef.current) visualRef.current.rotation.y = angleLerp(visualRef.current.rotation.y, p.ry, k)

    const m = motionRef.current
    // Their walking pace: from how fast they really moved between position updates
    // (which arrive in bursts, ~12 a second - one frame's jump would flicker between
    // a sprint and a standstill) and from the "walking" state they report.
    const now = performance.now()
    if (p.x !== l.sx || p.z !== l.sz) {
      const gap = Math.max(0.03, (now - l.st) / 1000)
      l.vel = Number.isNaN(l.sx) ? 0 : Math.min(25, Math.hypot(p.x - l.sx, p.z - l.sz) / gap)
      l.sx = p.x
      l.sz = p.z
      l.st = now
    } else if (now - l.st > 300) l.vel = 0
    const walking = p.anim === 1 || (p.anim === 3 && l.vel > 0.5)
    const pace = walking ? Math.max(l.vel, 3.5) : p.anim === 2 ? l.vel : 0
    m.time += dt
    m.speed += (pace - m.speed) * (1 - Math.exp(-8 * dt))
    m.grounded = p.anim !== 2
    if (p.anim === 3 && l.anim !== 3) m.swing = 0
    l.anim = p.anim
    if (m.swing >= 0) {
      m.swing += dt / SWING_TIME
      if (m.swing >= 1) m.swing = p.anim === 3 ? 0 : -1
    }
    // Their Boxity emote, from the moment they started it (server clock).
    if (p.emote && g.visible) emoteMotion(m, p.emote, performance.now() - (serverNow() - p.emoteAt))
    else m.emoteClip = null
  })

  return (
    <group ref={groupRef}>
      <group ref={visualRef}>
        <Avatar equipped={equipped} proportions={proportions} motionRef={motionRef} pickaxe={pickaxe} bagRef={bagRef} />
      </group>
    </group>
  )
})

export default function RemotePlayers() {
  const players = useNet((s) => s.players)
  return players.map((p) => <RemotePlayer key={p.id} id={p.id} avatar={p.avatar} pickaxe={p.pickaxe} />)
}
