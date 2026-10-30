import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'

import { moveMultiplier, safeAltitude, swingTime } from '@shared/catalog.js'
import { SPAWN, TREADMILL_SPEED, treadmillAt } from '@shared/world.js'
import { useBloxity } from '../bloxity/BloxityContext'
import { net, useNet } from '../net/net'
import { quality, useQuality } from '../store/quality'
import { spawnDebris } from './effects/fxBus'
import { ceilAbove, depthBelowSurface, floorBelow, groundTop, isSolid, surfaceAt } from './terrain/solid'
import Avatar from './avatar/Avatar'
import { sfx } from './audio'
import { emptyBag, syncBag } from './avatar/bagState'
import { emoteMotion, stopEmote } from './emotes'
import { cameraState, input, localPlayer } from './localPlayer'
import { groundHeight, resolveCollisions } from './world/ground'

const WALK_SPEED = 7
const SPRINT_MULT = 1.45
const GRAVITY = 34
const JUMP_SPEED = 11.5
const RADIUS = 0.45
/** How far below the feet the ground may drop and still be "stuck to" (slopes). */
const SNAP_DOWN = 0.9
/** Highest ledge you walk straight up onto; anything taller is a wall. */
const STEP_UP = 0.65
/** Head room the body needs: tunnels lower than this can't be walked into. */
const BODY = 1.75

/**
 * Whether the body fits standing at (x, z), starting from feet height y: the ground
 * there must be at most a step up, with room for the body above it.
 */
function canStand(x, y, z) {
  const h = surfaceAt(x, z)
  const g = floorBelow(x, y + STEP_UP, z, h)
  return ceilAbove(x, g + 0.05, z, h) - g >= BODY
}

/** canStand at the body's centre and at its leading edge, so you can't push your face into a wall. */
function bodyFits(x, y, z) {
  return canStand(x, y, z) && canStand(x + move.x * RADIUS, y, z + move.z * RADIUS)
}
const SEND_INTERVAL = 0.08

// Reused every frame; no allocation in the loop.
const move = { x: 0, z: 0 }
const sendMsg = { x: 0, y: 0, z: 0, ry: 0, anim: 0 }
const SNOW_PUFF = [0.93, 0.96, 1]
const DIRT_PUFF = [0.55, 0.47, 0.4]
const STEP_INTERVAL = 0.3

function angleLerp(a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/**
 * The local player: kinematic heightfield controller + avatar.
 *
 * Client-predicted: movement is applied immediately and streamed to the server at
 * ~12 Hz. The server owns everything economic, not position.
 */
export default function PlayerController({ onReady }) {
  const groupRef = useRef(null)
  const visualRef = useRef(null)
  const sendTimer = useRef(0)
  const stepTimer = useRef(0)
  const motionRef = useRef({ time: 0, speed: 0, maxSpeed: WALK_SPEED, grounded: true, swing: -1 })
  const { avatar: equipped, proportions } = useBloxity()
  const pickaxe = useNet((s) => s.me?.pickaxe ?? 'rusted')
  const shadows = useQuality((s) => s.settings.shadows)
  const warmthRef = useRef(12)
  /** Upgrade levels, mirrored outside React for the frame loop. */
  const levelsRef = useRef({ swing: 0, speed: 0 })
  /** What the backpack on your back shows: load, capacity, colours inside. */
  const bagRef = useRef(null)
  if (!bagRef.current) bagRef.current = emptyBag()
  useEffect(
    () =>
      useNet.subscribe((s) => {
        if (s.me) syncBag(bagRef.current, s.me.backpack, s.me.backpackCap)
        warmthRef.current = s.me?.warmth ?? 12
        levelsRef.current.swing = s.me?.swingLvl ?? 0
        levelsRef.current.speed = s.me?.speedLvl ?? 0
      }),
    [],
  )

  useEffect(() => {
    localPlayer.y = groundHeight(localPlayer.x, localPlayer.z)
  }, [])

  useFrame((_state, rawDelta) => {
    const dt = Math.min(rawDelta, 0.05)
    const p = localPlayer
    p.time += dt

    if (p.teleportRequested) {
      p.teleportRequested = false
      p.x = SPAWN.x + (Math.random() - 0.5) * 4
      p.z = SPAWN.z
      p.y = groundHeight(p.x, p.z)
      p.vy = 0
      p.ry = SPAWN.ry
    }

    // --- Input -> camera-relative direction ----------------------------------
    // Frozen (dead) or held still for an ad break: no control until it's over.
    const held = p.dead || p.paused
    let ix = held ? 0 : (input.right ? 1 : 0) - (input.left ? 1 : 0) + input.joyX
    let iz = held ? 0 : (input.forward ? 1 : 0) - (input.backward ? 1 : 0) + input.joyY
    const len = Math.hypot(ix, iz)
    if (len > 1) {
      ix /= len
      iz /= len
    }
    // Camera sits at yaw behind the player; forward is away from it.
    const fx = -Math.sin(cameraState.yaw)
    const fz = -Math.cos(cameraState.yaw)
    move.x = fx * iz - fz * ix
    move.z = fz * iz + fx * ix

    const moving = len > 0.05
    let speed = WALK_SPEED * moveMultiplier(levelsRef.current.speed) * (input.sprint ? SPRINT_MULT : 1) * Math.min(1, len)

    if (moving) {
      // Uphill is slower: probe the slope half a metre ahead.
      const g0 = floorBelow(p.x, p.y + STEP_UP, p.z)
      const g1 = floorBelow(p.x + move.x * 0.5, p.y + STEP_UP, p.z + move.z * 0.5)
      const slope = (g1 - g0) / 0.5
      if (slope > 0) speed /= 1 + slope * 0.55
      const nx = p.x + move.x * speed * dt
      const nz = p.z + move.z * speed * dt
      // Blocked straight ahead? Slide along the wall on one axis.
      if (bodyFits(nx, p.y, nz)) {
        p.x = nx
        p.z = nz
      } else if (bodyFits(nx, p.y, p.z)) p.x = nx
      else if (bodyFits(p.x, p.y, nz)) p.z = nz
      if (p.swing < 0) p.ry = angleLerp(p.ry, Math.atan2(move.x, move.z), 1 - Math.pow(0.0005, dt))
    }
    // Standing on a treadmill: it carries you along its lane.
    const belt = p.grounded && p.y < 0.8 ? treadmillAt(p.x, p.z) : null
    if (belt) {
      const bx = p.x + belt.dir * TREADMILL_SPEED * dt
      if (bodyFits(bx, p.y, p.z)) p.x = bx
    }
    // First person: you face where you look (others see you turn with your view).
    if (cameraState.eyes && p.swing < 0) p.ry = Math.atan2(-Math.sin(cameraState.yaw), -Math.cos(cameraState.yaw))
    resolveCollisions(p, RADIUS)

    // --- Vertical: gravity, jumping, ceilings, sticking to slopes -------------
    // Ground is only ever removed, so being inside it means a glitch or a bad
    // teleport: lift the player back to the top instead of leaving them stuck.
    if (isSolid(p.x, p.y + 0.9, p.z)) {
      p.y = groundTop(p.x, p.z)
      p.vy = 0
    }
    const surface = surfaceAt(p.x, p.z)
    const ground = floorBelow(p.x, p.y + STEP_UP, p.z, surface)
    if (input.jump && p.grounded && !held) {
      p.vy = JUMP_SPEED
      p.grounded = false
    }
    const fallSpeed = p.vy
    const wasAirborne = !p.grounded
    p.vy -= GRAVITY * dt
    p.y += p.vy * dt
    // Bump your head on tunnel ceilings.
    const ceiling = ceilAbove(p.x, Math.max(p.y, ground) + 0.1, p.z, surface)
    if (p.y + BODY > ceiling && p.vy > 0) {
      p.vy = 0
      p.y = Math.max(ground, ceiling - BODY)
    }
    if (p.y <= ground) {
      // Landing puff, sized by how hard you came down.
      if (wasAirborne && fallSpeed < -8 && quality().particles) {
        spawnDebris(p.x, ground + 0.1, p.z, depthBelowSurface(p.x, ground, p.z) > 0.5 ? DIRT_PUFF : SNOW_PUFF, 6, 0.6)
      }
      p.y = ground
      p.vy = 0
      p.grounded = true
    } else if (p.grounded && p.vy <= 0 && p.y - ground < SNAP_DOWN + speed * dt) {
      p.y = ground
      p.vy = 0
    } else {
      p.grounded = false
    }

    // --- Cold: above the warmth-safe altitude the meter fills ----------------
    const safe = safeAltitude(warmthRef.current)
    if (held) {
      // Dead stays frozen solid; an ad break doesn't cost you warmth.
    } else if (p.y > safe) p.cold = Math.min(1, p.cold + dt * (0.035 + (p.y - safe) / 260))
    else p.cold = Math.max(0, p.cold - dt * 0.2)
    if (p.cold >= 1 && !p.dead) {
      // Frozen: Boxity's death screen opens (the UI ticker sees `froze`), and only its
      // Respawn button brings you back to base - never a timer.
      p.dead = true
      p.froze = true
      p.swing = -1
      stopEmote()
    }

    // --- Swing timer --------------------------------------------------------
    if (p.swing >= 0) {
      p.swing += dt / swingTime(levelsRef.current.swing)
      if (p.swing >= 1) p.swing = -1
    }

    // Little kicks of snow at each step.
    if (moving && p.grounded) {
      stepTimer.current += dt * (speed / WALK_SPEED)
      if (stepTimer.current > STEP_INTERVAL) {
        stepTimer.current = 0
        sfx.step()
        if (quality().particles) {
          spawnDebris(p.x, p.y + 0.05, p.z, depthBelowSurface(p.x, p.y, p.z) > 0.5 ? DIRT_PUFF : SNOW_PUFF, 2, 0.3)
        }
      }
    }

    p.speed = moving ? speed : 0
    p.anim = p.swing >= 0 ? 3 : !p.grounded ? 2 : moving ? 1 : 0

    const m = motionRef.current
    m.time = p.time
    m.speed = p.speed
    m.maxSpeed = WALK_SPEED
    m.grounded = p.grounded
    m.swing = p.swing
    m.aimPitch = p.aimPitch
    // A Boxity emote plays until it ends, or until you move, jump or swing.
    if (p.emote && (moving || p.swing >= 0 || !p.grounded || !emoteMotion(m, p.emote, p.emoteAt))) {
      stopEmote()
      m.emoteClip = null
    } else if (!p.emote) m.emoteClip = null

    groupRef.current?.position.set(p.x, p.y, p.z)
    if (visualRef.current) {
      visualRef.current.rotation.y = p.ry
      // The camera is squeezed right behind you in a tunnel: get out of its way.
      visualRef.current.visible = !cameraState.close
    }

    // --- Network ------------------------------------------------------------
    sendTimer.current += dt
    if (sendTimer.current >= SEND_INTERVAL && net.room) {
      sendTimer.current = 0
      sendMsg.x = Math.round(p.x * 100) / 100
      sendMsg.y = Math.round(p.y * 100) / 100
      sendMsg.z = Math.round(p.z * 100) / 100
      sendMsg.ry = Math.round(p.ry * 100) / 100
      sendMsg.anim = p.anim
      net.room.send('move', sendMsg)
    }
  })

  return (
    <group ref={groupRef}>
      <group ref={visualRef}>
        <Avatar
          equipped={equipped}
          proportions={proportions}
          motionRef={motionRef}
          pickaxe={pickaxe}
          castShadow={shadows}
          onReady={onReady}
          bagRef={bagRef}
          showTag
        />
      </group>
    </group>
  )
}
