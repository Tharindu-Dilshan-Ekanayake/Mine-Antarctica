import { Color, Raycaster, Vector2, Vector3 } from 'three'

import { CRYSTAL_BY_ID, PICKAXE_BY_ID, swingTime } from '@shared/catalog.js'
import { digBalls, digProblem, digRadius, PLOT_SIZE, PLOTS, plotContains, REACH, STALLS, STALL_REACH } from '@shared/world.js'
import { net, send, useNet } from '../net/net'
import { useUI } from '../store/ui'
import { sfx } from './audio'
import { crystalPickSphere } from './crystals/crystalMath'
import { spawnDebris, spawnFloat } from './effects/fxBus'
import { itemInSlot } from './hotbar'
import { aim, cameraState, input, localPlayer, placement, pointer } from './localPlayer'
import { getSeed } from './terrain/heightGrid'
import { depthBelowSurface, raycastSolid, surfaceAt } from './terrain/solid'

/**
 * What the player's clicks and taps do: swing the pickaxe (dig / hit a crystal),
 * throw a bomb, use a radar, or place a crystal in the garden.
 *
 * Driven by pointer events and a swing interval, never from useFrame, so it is free
 * to update UI state (toasts, modals).
 */

let camera = null
export function setInteractionCamera(c) {
  camera = c
}

const raycaster = new Raycaster()
const ndc = new Vector2()
const hit = new Vector3()
const _color = new Color()
const SNOW_RGB = [0.92, 0.95, 0.99]
const ROCK_RGB = [0.42, 0.37, 0.33]

let swingTimer = null

/** Seconds per swing for the local player right now (Mine Faster applies live). */
export const mySwingTime = () => swingTime(useNet.getState().me?.swingLvl ?? 0)

export function startAction(touch = false) {
  input.action = true
  input.touchAim = touch
  swing(true)
  clearTimeout(swingTimer)
  const again = () => {
    if (!input.action) return
    swing(false)
    swingTimer = setTimeout(again, mySwingTime() * 1000)
  }
  swingTimer = setTimeout(again, mySwingTime() * 1000)
}

export function stopAction() {
  input.action = false
  clearTimeout(swingTimer)
  swingTimer = null
}

function face(x, z) {
  localPlayer.ry = Math.atan2(x - localPlayer.x, z - localPlayer.z)
}

const _origin = new Vector3()
const _dir = new Vector3()
/** Height of the chest above the feet: swings and reach are measured from here. */
const CHEST = 1.3
/** Where touch players aim: just below the middle of the screen, past their own avatar. */
const TOUCH_NDC = { x: 0, y: -0.12 }

/**
 * Touch: where a finger tapped (or is holding) on the screen, in NDC. While it is live
 * - the finger is down, or for a moment after a tap so the marker stays put - the
 * pickaxe aims there instead of at the fixed point in front of the player.
 */
export const touchPoint = { x: 0, y: 0, active: false, until: 0 }
/** How long the dig marker stays on a tapped spot. */
const TAP_LINGER_MS = 900

/** Aims touch digging at screen point (ndcX, ndcY): a tap, or a finger held down. */
export function aimTouchAt(ndcX, ndcY, held) {
  touchPoint.x = ndcX
  touchPoint.y = ndcY
  touchPoint.active = held
  touchPoint.until = performance.now() + TAP_LINGER_MS
}

/** The finger lifted: the marker lingers a moment on that spot, then goes back in front. */
export function releaseTouchAim() {
  touchPoint.active = false
  touchPoint.until = performance.now() + TAP_LINGER_MS
}

const touchPointLive = () => touchPoint.active || performance.now() < touchPoint.until
const usingCursor = () => !input.touchAim && pointer.inside && camera

/** Sets _origin/_dir to the aiming ray: through the cursor, a tapped point, or the screen on touch. */
function aimRay() {
  if (!camera) return false
  if (usingCursor()) ndc.set(pointer.x, pointer.y)
  else if (touchPointLive()) ndc.set(touchPoint.x, touchPoint.y)
  else if (cameraState.eyes) ndc.set(0, -0.06)
  else ndc.set(TOUCH_NDC.x, TOUCH_NDC.y)
  raycaster.setFromCamera(ndc, camera)
  _origin.copy(raycaster.ray.origin)
  _dir.copy(raycaster.ray.direction)
  return true
}

/**
 * First solid ground along the aiming ray, within `maxDist` of the player's chest.
 * When the cursor points at ground out of reach (or at the sky), it falls back to
 * a ray from the chest in the same direction, so you can always dig straight ahead,
 * down at your feet or up into a ceiling. Writes `hit` and returns it, or null.
 */
function aimedGround(maxDist) {
  if (!aimRay()) return null
  const cx = localPlayer.x
  const cy = localPlayer.y + CHEST
  const cz = localPlayer.z
  // Start the ray level with the player: ground between the camera and you (the rim
  // of the hole you're standing in, say) is never what you meant to dig.
  const skip = Math.max(0, (cx - _origin.x) * _dir.x + (cy - _origin.y) * _dir.y + (cz - _origin.z) * _dir.z - 0.6)
  _origin.addScaledVector(_dir, skip)
  // Anything past arm's reach is thrown away below, so don't march further than that.
  const t = raycastSolid(_origin.x, _origin.y, _origin.z, _dir.x, _dir.y, _dir.z, maxDist * 2 + 2)
  if (t >= 0) {
    hit.copy(_dir).multiplyScalar(t).add(_origin)
    const dx = hit.x - cx
    const dy = hit.y - cy
    const dz = hit.z - cz
    if (dx * dx + dy * dy + dz * dz <= maxDist * maxDist) return hit
  }
  const t2 = raycastSolid(cx, cy, cz, _dir.x, _dir.y, _dir.z, maxDist)
  if (t2 < 0) return null
  hit.set(cx + _dir.x * t2, cy + _dir.y * t2, cz + _dir.z * t2)
  return hit
}

/**
 * Updates the shared `aim` (dig target, direction, ball size) for this frame.
 * Called every frame by the interaction driver; pure maths, no state writes.
 */
export function updateAim(me) {
  const p = aimedGround(REACH)
  if (!p || !me) {
    aim.valid = false
    return
  }
  const cy = localPlayer.y + CHEST
  let dx = p.x - localPlayer.x
  let dy = p.y - cy
  let dz = p.z - localPlayer.z
  const l = Math.hypot(dx, dy, dz) || 1
  dx /= l
  dy /= l
  dz /= l
  const r = digRadius(PICKAXE_BY_ID[me.pickaxe] ?? PICKAXE_BY_ID.rusted)
  // The ball sits a little past the surface, so each swing bites into the face you hit.
  aim.x = p.x + dx * r * 0.45
  aim.y = p.y + dy * r * 0.45
  aim.z = p.z + dz * r * 0.45
  aim.hx = p.x
  aim.hy = p.y
  aim.hz = p.z
  aim.dx = dx
  aim.dy = dy
  aim.dz = dz
  aim.r = r
  // What the swing really removes: a tall tunnel bite when it's level with you (the
  // same rule the server carves by), so the preview shows the opening you'll walk into.
  const seed = getSeed()
  const balls = digBalls(aim.x, aim.y, aim.z, dy, r, localPlayer.y)
  const ok = balls.some((b) => !digProblem(b.x, b.y, b.z, b.r, seed))
  aim.problem = ok ? '' : digProblem(aim.x, aim.y, aim.z, r, seed) || 'air'
  if (balls.length > 1) {
    const top = balls[balls.length - 1].y
    aim.my = (balls[0].y + top) / 2
    aim.sy = (top - balls[0].y) / 2 + r
  } else {
    aim.my = aim.y
    aim.sy = r
  }
  aim.valid = true
}

/** A crystal in `state` along the aiming ray (or right in front, on touch), within reach. */
function pickCrystal(state) {
  const crystals = net.room?.state.crystals
  if (!crystals || !aimRay()) return null
  let best = null
  let bestScore = Infinity
  const slack = usingCursor() ? 0 : 0.6
  const chestY = localPlayer.y + CHEST
  crystals.forEach((c, id) => {
    if (c.state !== state) return
    const { cy, r } = crystalPickSphere(c)
    const dx = c.x - localPlayer.x
    const dy = cy - chestY
    const dz = c.z - localPlayer.z
    const reach = REACH + 1 + r
    if (dx * dx + dy * dy + dz * dz > reach * reach) return
    hit.set(c.x, cy, c.z).sub(_origin)
    const t = hit.dot(_dir)
    if (t < 0) return
    const miss2 = hit.lengthSq() - t * t
    const rr = r + slack
    if (miss2 <= rr * rr && t < bestScore) {
      bestScore = t
      best = { id, c, cy }
    }
  })
  if (best || usingCursor()) return best
  // Touch fallback: the closest one in front of you, within arm's length.
  crystals.forEach((c, id) => {
    if (c.state !== state) return
    const { cy } = crystalPickSphere(c)
    const dx = c.x - localPlayer.x
    const dy = cy - chestY
    const dz = c.z - localPlayer.z
    const d2 = dx * dx + dy * dy + dz * dz
    const ahead = (dx * Math.sin(localPlayer.ry) + dz * Math.cos(localPlayer.ry)) / Math.sqrt(d2 + 1e-6)
    if (d2 < 9 && ahead > 0.2 && d2 < bestScore) {
      bestScore = d2
      best = { id, c, cy }
    }
  })
  return best
}

/** Nearest loose crystal the player may pick up, within `range`. */
export function nearestLoose(range = 5) {
  const crystals = net.room?.state.crystals
  if (!crystals) return null
  const me = net.room.sessionId
  let best = null
  let bestD = range * range
  crystals.forEach((c, id) => {
    if (c.state !== 1) return
    const dx = c.x - localPlayer.x
    const dz = c.z - localPlayer.z
    const d2 = dx * dx + dz * dz
    if (d2 < bestD) {
      bestD = d2
      best = { id, c, mine: !c.owner || c.owner === me }
    }
  })
  return best
}

/** Stall the player is standing at, or null. */
export function nearestStall() {
  for (const s of STALLS) {
    const dx = localPlayer.x - s.x
    const dz = localPlayer.z - (s.z + 3.6)
    if (Math.abs(dx) < 4.2 && dz > -1.2 && dz < STALL_REACH) return s
  }
  return null
}

function debrisColor(x, y, z) {
  return depthBelowSurface(x, y, z) > 0.6 ? ROCK_RGB : SNOW_RGB
}

function swing(first) {
  const ui = useUI.getState()
  const me = useNet.getState().me
  if (!me || ui.modal || ui.sellDialog || localPlayer.dead || localPlayer.paused) return
  const item = itemInSlot(me, ui.slot)

  if (item) {
    if (!first) return
    applyItem(item)
    return
  }

  localPlayer.swing = 0

  const buried = pickCrystal(0)
  if (buried) {
    face(buried.c.x, buried.c.z)
    localPlayer.aimPitch = Math.atan2(buried.cy - localPlayer.y - CHEST, Math.hypot(buried.c.x - localPlayer.x, buried.c.z - localPlayer.z))
    send('hit', { id: buried.id })
    const power = PICKAXE_BY_ID[me.pickaxe]?.power ?? 25
    spawnFloat(buried.c.x, buried.cy + 1.2, buried.c.z, `-${power}`, '#ff5a5a')
    _color.set(CRYSTAL_BY_ID[buried.c.type]?.color ?? '#ffffff')
    spawnDebris(buried.c.x, buried.cy, buried.c.z, [_color.r, _color.g, _color.b], 6)
    cameraState.shake = Math.max(cameraState.shake, 0.06)
    if (buried.c.hp <= buried.c.maxHp * 0.3) sfx.shatter()
    else sfx.hit()
    return
  }

  // Loose crystals are never grabbed by a swing: walk up and press E (or tap
  // PICK UP) to put one in the bag.

  updateAim(me)
  if (!aim.valid) {
    if (first) ui.toast('Nothing to break here \u26cf\ufe0f', 'error')
    return
  }
  if (aim.problem) {
    const why = {
      offMountain: 'You can only dig at the mountain! Go there \u26cf\ufe0f',
      bedrock: "Bedrock! You can't dig any deeper here",
      tooDeep: 'Too deep! The mountain is frozen solid down here',
      air: 'Nothing to break here \u26cf\ufe0f',
    }[aim.problem]
    ui.toast(why, aim.problem === 'air' ? 'error' : 'warn')
    return
  }
  face(aim.hx, aim.hz)
  localPlayer.aimPitch = Math.asin(Math.max(-1, Math.min(1, aim.dy)))
  send('dig', { x: aim.x, y: aim.y, z: aim.z, dx: aim.dx, dy: aim.dy, dz: aim.dz })
  // Chunks fly back out of the face you hit.
  spawnDebris(aim.hx - aim.dx * 0.2, aim.hy - aim.dy * 0.2, aim.hz - aim.dz * 0.2, debrisColor(aim.hx, aim.hy, aim.hz), 10)
  // A tunnel bite bursts open from floor to ceiling: rubble tumbles out at your feet too.
  if (aim.sy > aim.r * 1.2) {
    const fy = aim.my - aim.sy * 0.6
    spawnDebris(aim.hx - aim.dx * 0.3, fy, aim.hz - aim.dz * 0.3, debrisColor(aim.hx, fy, aim.hz), 8, 0.8)
  }
  cameraState.shake = Math.max(cameraState.shake, 0.05)
  if (aim.sy > aim.r * 1.2) sfx.tunnel()
  else sfx.dig()
}

function applyItem(item) {
  const ui = useUI.getState()
  if (item.kind === 'crystal') {
    if (!placement.active) {
      ui.toast('Go to YOUR garden plot to place crystals', 'warn')
      return
    }
    if (!placement.valid) {
      ui.toast('Place it inside your plot', 'warn')
      return
    }
    send('place', { uid: item.uid, x: placement.x, z: placement.z, rot: placement.rot })
    sfx.pickup()
    return
  }
  if (item.kind === 'bomb') {
    const p = aimedGround(14)
    const bad = p ? digProblem(p.x, p.y, p.z, 1, getSeed()) : 'offMountain'
    if (bad === 'offMountain' || bad === 'air') {
      ui.toast('Throw bombs at the mountain!', 'warn')
      return
    }
    localPlayer.swing = 0
    face(p.x, p.z)
    send('useItem', { uid: item.uid, x: p.x, y: p.y, z: p.z })
    ui.setSlot(0)
    return
  }
  if (item.kind === 'radar') {
    send('useItem', { uid: item.uid })
    ui.setSlot(0)
  }
}

/** Crystals we asked to pick up: when one vanishes, it went into our bag. */
export const pendingPickups = new Set()

export function pickUp(id) {
  if (pendingPickups.size > 50) pendingPickups.clear()
  pendingPickups.add(id)
  send('pickup', { id })
  sfx.pickup()
}

/** E key / touch interact button. */
export function interact() {
  if (localPlayer.dead || localPlayer.paused) return
  const ui = useUI.getState()
  if (placement.active) {
    placement.rot += Math.PI / 8
    return
  }
  const loose = nearestLoose(5)
  if (loose) {
    pickUp(loose.id)
    return
  }
  const stall = nearestStall()
  if (stall) openStall(stall.id)
  else if (ui.modal) ui.closeModal()
}

export function openStall(id) {
  const ui = useUI.getState()
  if (id === 'sell') useUI.setState({ sellDialog: true })
  else ui.openModal(id)
}

/** Q key in placement mode. */
export function rotateBack() {
  if (placement.active) placement.rot -= Math.PI / 8
}

/**
 * Updates the garden placement preview. Called every frame by the driver; pure
 * maths into the `placement` object.
 */
export function updatePlacement(me, slot) {
  const item = itemInSlot(me, slot)
  const plot = me ? PLOTS[me.plot] : null
  const inPlot = plot && plotContains(me.plot, localPlayer.x, localPlayer.z, -2)
  if (!item || item.kind !== 'crystal' || !inPlot) {
    placement.active = false
    return
  }
  placement.active = true
  placement.type = item.type
  placement.weight = item.weight
  const p = aimedGround(PLOT_SIZE)
  if (p) {
    placement.x = p.x
    placement.z = p.z
  } else {
    placement.x = localPlayer.x + Math.sin(localPlayer.ry) * 2.5
    placement.z = localPlayer.z + Math.cos(localPlayer.ry) * 2.5
  }
  placement.valid = plotContains(me.plot, placement.x, placement.z) && me.garden.length < me.gardenSlots
}

/** Original surface height under the player (for the HUD). */
export function originalAltitudeHere() {
  return surfaceAt(localPlayer.x, localPlayer.z)
}
