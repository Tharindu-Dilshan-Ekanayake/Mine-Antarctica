import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Vector3 } from 'three'

import { cameraState, localPlayer, pointer } from './localPlayer'
import { raycastSolid } from './terrain/solid'

/** How high above the player's feet the camera aims. */
const LOOK_HEIGHT = 1.6
const MIN_DISTANCE = 4
const MAX_DISTANCE = 32
const MIN_PITCH = -0.2
const MAX_PITCH = 1.35
const DRAG_SENSITIVITY = 0.006
const ZOOM_SENSITIVITY = 0.012
/**
 * How far the camera stays off any ground between it and the player. Tunnel walls are
 * drawn from 1 m blocks and can bulge up to half a metre past the dug shape, so this
 * leaves room for that: the camera never ends up behind a wall, seeing out.
 */
const CLEARANCE = 0.8
/** Minimum distance, so the camera never ends up inside the avatar's head. */
const NEAR_LIMIT = 0.3
/** Rock closer than this above your head means you're in a tunnel. */
const TUNNEL_ROOF = 3
/** The camera's tilt in a tunnel: nearly level, looking down its length. */
const TUNNEL_PITCH = 0.12
/** Closer than this, the local avatar is hidden. */
const CLOSE_FADE = 0.9
/** First person: eye height above the feet, and how far up / down you can look. */
const EYE_HEIGHT = 1.55
const FP_MIN_PITCH = -1.25
const FP_MAX_PITCH = 1.45
const _dir = new Vector3()
const _eye = new Vector3()
const _eyeLook = new Vector3()
/** Seconds for the camera to glide into your eyes in a tunnel (and back out). */
const TUNNEL_GLIDE = 0.35

const _desired = new Vector3()
const _target = new Vector3()
const _offset = new Vector3()

/**
 * The player's camera: third person (an orbit behind you) or first person (through your
 * eyes - best deep in a tunnel or down a shaft, where an orbit camera can't follow).
 *
 * Desktop: right-drag orbits, wheel zooms. Touch: drag on empty screen orbits,
 * pinch zooms (the joystick and buttons stop their own touches from reaching here).
 * Also tracks the cursor in NDC for picking.
 */
export default function FollowCamera() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const lookAt = useRef(new Vector3())
  const initialised = useRef(false)

  useEffect(() => {
    const el = gl.domElement
    let dragId = null
    let lastX = 0
    let lastY = 0
    const touches = new Map()
    let pinchDist = 0

    const updatePointer = (e) => {
      const rect = el.getBoundingClientRect()
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
      pointer.inside = e.pointerType === 'mouse'
    }

    const onPointerDown = (e) => {
      updatePointer(e)
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (touches.size === 2) {
          const [a, b] = [...touches.values()]
          pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
          dragId = null
          return
        }
      } else if (e.button !== 2) {
        return
      }
      dragId = e.pointerId
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
    }

    const onPointerMove = (e) => {
      updatePointer(e)
      if (touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (touches.size === 2) {
          const [a, b] = [...touches.values()]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          cameraState.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, cameraState.distance - (d - pinchDist) * 0.04))
          pinchDist = d
          return
        }
      }
      if (dragId !== e.pointerId) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      // A finger held down to dig steers the pickaxe, not the camera.
      if (cameraState.dragLocked) return
      cameraState.yaw -= dx * DRAG_SENSITIVITY
      const first = cameraState.mode === 'first'
      cameraState.pitch = Math.min(first ? FP_MAX_PITCH : MAX_PITCH, Math.max(first ? FP_MIN_PITCH : MIN_PITCH, cameraState.pitch + dy * DRAG_SENSITIVITY))
    }

    const endDrag = (e) => {
      touches.delete(e.pointerId)
      if (dragId !== e.pointerId) return
      dragId = null
      el.releasePointerCapture?.(e.pointerId)
    }

    const onWheel = (e) => {
      e.preventDefault()
      if (cameraState.mode === 'first') return
      cameraState.distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, cameraState.distance + e.deltaY * ZOOM_SENSITIVITY))
    }
    const onContextMenu = (e) => e.preventDefault()
    const onLeave = () => {
      pointer.inside = false
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('contextmenu', onContextMenu)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('contextmenu', onContextMenu)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl])

  const tilt = useRef(cameraState.pitch)

  /** 0 = orbit behind you, 1 = at your eyes: how far into the tunnel view we are. */
  const tunnelBlend = useRef(0)

  useFrame((_state, delta) => {
    // --- In a tunnel the third-person camera glides into your eyes ---------------------
    // An orbit camera can't follow you down a tunnel: there's no room behind you, so it
    // would end up in the rock. With rock right over your head, the view moves to your
    // eyes; walk back out into the open and it glides back behind you.
    const headY = localPlayer.y + LOOK_HEIGHT
    const underRock = cameraState.mode !== 'first' && raycastSolid(localPlayer.x, headY, localPlayer.z, 0, 1, 0, TUNNEL_ROOF) >= 0
    const step = delta / TUNNEL_GLIDE
    tunnelBlend.current = Math.min(1, Math.max(0, tunnelBlend.current + (underRock ? step : -step)))
    const blend = tunnelBlend.current * tunnelBlend.current * (3 - 2 * tunnelBlend.current)
    // Read by the controller (you face where you look), the touch aim and the held tool.
    cameraState.eyes = cameraState.mode === 'first' || blend > 0.6

    // --- First person: the camera is your eyes ----------------------------------------
    if (cameraState.mode === 'first') {
      const p = localPlayer
      // A gentle head bob while you walk.
      const bob = p.grounded ? Math.sin(p.time * 11) * 0.035 * Math.min(1, p.speed / 7) : 0
      camera.position.set(p.x, p.y + EYE_HEIGHT + bob, p.z)
      const cp = Math.cos(cameraState.pitch)
      _dir.set(-Math.sin(cameraState.yaw) * cp, -Math.sin(cameraState.pitch), -Math.cos(cameraState.yaw) * cp)
      lookAt.current.copy(camera.position).add(_dir)
      camera.lookAt(lookAt.current)
      // Your own body would fill the screen: it stays hidden (others still see you).
      cameraState.close = true
      tilt.current = Math.max(MIN_PITCH, cameraState.pitch)
      initialised.current = false
      if (cameraState.shake > 0.001) {
        camera.position.x += (Math.random() - 0.5) * cameraState.shake * 0.5
        camera.position.y += (Math.random() - 0.5) * cameraState.shake * 0.5
        cameraState.shake *= Math.pow(0.02, delta)
      }
      return
    }
    // Out of the eyes view: the normal view angle again.
    if (!cameraState.eyes && camera.fov !== 60) {
      camera.fov = 60
      camera.updateProjectionMatrix()
    }
    // Back from first person: looking up isn't something the orbit camera does.
    if (cameraState.pitch < MIN_PITCH) cameraState.pitch = MIN_PITCH
    if (cameraState.pitch > MAX_PITCH) cameraState.pitch = MAX_PITCH

    _target.set(localPlayer.x, localPlayer.y + LOOK_HEIGHT, localPlayer.z)
    const { yaw, distance } = cameraState
    // Underground (rock right overhead): look along the tunnel, not up into its roof,
    // so you see how far you've dug. Eased, so walking in and out never snaps.
    const roof = raycastSolid(_target.x, _target.y, _target.z, 0, 1, 0, TUNNEL_ROOF)
    const wantTilt = roof >= 0 ? Math.min(cameraState.pitch, TUNNEL_PITCH) : cameraState.pitch
    tilt.current += (wantTilt - tilt.current) * (1 - Math.pow(0.02, delta))
    const pitch = tilt.current
    const horizontal = Math.cos(pitch) * distance
    _desired.set(
      _target.x + Math.sin(yaw) * horizontal,
      _target.y + Math.sin(pitch) * distance,
      _target.z + Math.cos(yaw) * horizontal,
    )
    // Spring arm: pull the camera in front of any ground between it and the player,
    // so it never sees through the mountain or out of a tunnel.
    const ax = _desired.x - _target.x
    const ay = _desired.y - _target.y
    const az = _desired.z - _target.z
    const len = Math.hypot(ax, ay, az)
    const hitT = raycastSolid(_target.x, _target.y, _target.z, ax / len, ay / len, az / len, len + CLEARANCE)
    const allowed = hitT >= 0 ? Math.max(NEAR_LIMIT, hitT - CLEARANCE) : len
    if (allowed < len) {
      const t = allowed / len
      _desired.set(_target.x + ax * t, _target.y + ay * t, _target.z + az * t)
    }

    if (!initialised.current) {
      camera.position.copy(_desired)
      lookAt.current.copy(_target)
      initialised.current = true
    }
    camera.position.lerp(_desired, 1 - Math.pow(0.0001, delta))
    // Never let the easing carry the camera behind a wall: clamp its distance.
    _offset.copy(camera.position).sub(_target)
    const now = _offset.length()
    if (now > allowed) camera.position.copy(_target).addScaledVector(_offset, allowed / now)
    // Squeezed right up behind you in a tight tunnel: your avatar steps aside (fades)
    // so it doesn't fill the screen.
    cameraState.close = Math.min(now, allowed) < CLOSE_FADE
    lookAt.current.lerp(_target, 1 - Math.pow(0.00001, delta))

    // Tunnel: blend from the orbit pose to your eyes, looking down the tunnel.
    if (blend > 0.001) {
      const bob = localPlayer.grounded ? Math.sin(localPlayer.time * 11) * 0.03 * Math.min(1, localPlayer.speed / 7) : 0
      _eye.set(localPlayer.x, localPlayer.y + EYE_HEIGHT + bob, localPlayer.z)
      const cp = Math.cos(pitch)
      _eyeLook.set(-Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp).multiplyScalar(4).add(_eye)
      camera.position.lerp(_eye, blend)
      _eyeLook.lerp(lookAt.current, 1 - blend)
      camera.lookAt(_eyeLook)
      if (blend > 0.6) cameraState.close = true
    } else {
      camera.lookAt(lookAt.current)
    }

    // Explosion shake: a decaying jitter on top of the smoothed pose.
    if (cameraState.shake > 0.001) {
      const s = cameraState.shake
      camera.position.x += (Math.random() - 0.5) * s
      camera.position.y += (Math.random() - 0.5) * s
      cameraState.shake *= Math.pow(0.02, delta)
    }
  })

  return null
}
