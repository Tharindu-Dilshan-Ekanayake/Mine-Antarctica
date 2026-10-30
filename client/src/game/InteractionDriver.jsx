import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Color, IcosahedronGeometry, MeshBasicMaterial } from 'three'

import { useNet } from '../net/net'
import { useUI } from '../store/ui'
import { aimTouchAt, releaseTouchAim, setInteractionCamera, startAction, stopAction, updateAim, updatePlacement } from './interaction'
import { pickaxeCursor } from './cursor'
import { aim, cameraState, localPlayer } from './localPlayer'

/** A touch that moves less than this (px) is a tap or a hold, not a camera drag. */
const TAP_MOVE = 12
/** Holding a finger still this long (ms) digs continuously where it is. */
const HOLD_MS = 260

/**
 * Wires mouse buttons and touches to actions and keeps the garden placement preview
 * current. Mouse: left-click (hold) swings; right-drag is the camera's. Touch: a tap
 * digs exactly where you tapped, holding a finger still keeps digging under it, and a
 * drag still turns the camera.
 */
export default function InteractionDriver() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)

  useEffect(() => {
    setInteractionCamera(camera)
  }, [camera])

  useEffect(() => {
    const el = gl.domElement
    const down = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      startAction(false)
    }
    const up = (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) stopAction()
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', stopAction)

    // --- Touch: tap to dig there, hold to keep digging --------------------------------
    /** The finger being watched: { id, x, y, ndc, moved, holding, timer }, or null. */
    let touch = null
    const ndcOf = (e) => {
      const rect = el.getBoundingClientRect()
      return [((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1]
    }
    // Digging by touch only means something on the mountain, or with an item in hand
    // (bombs, radars, a crystal to place); elsewhere a tap is just a tap.
    const canAct = () => useUI.getState().onMountain || useUI.getState().slot !== 0
    const release = () => {
      if (!touch) return
      clearTimeout(touch.timer)
      if (touch.holding) {
        stopAction()
        releaseTouchAim()
      }
      cameraState.dragLocked = false
      touch = null
    }
    const touchDown = (e) => {
      if (e.pointerType !== 'touch') return
      // A second finger is a pinch: whatever the first one was doing stops.
      if (touch) {
        release()
        return
      }
      const t = { id: e.pointerId, x: e.clientX, y: e.clientY, ndc: ndcOf(e), moved: false, holding: false, timer: 0 }
      touch = t
      t.timer = setTimeout(() => {
        if (touch !== t || t.moved || !canAct()) return
        t.holding = true
        // While digging under the finger, sliding it moves the dig, not the camera.
        cameraState.dragLocked = true
        aimTouchAt(t.ndc[0], t.ndc[1], true)
        startAction(true)
      }, HOLD_MS)
    }
    const touchMove = (e) => {
      if (!touch || e.pointerId !== touch.id) return
      touch.ndc = ndcOf(e)
      if (touch.holding) aimTouchAt(touch.ndc[0], touch.ndc[1], true)
      else if (Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > TAP_MOVE) {
        touch.moved = true
        clearTimeout(touch.timer)
      }
    }
    const touchUp = (e) => {
      if (!touch || e.pointerId !== touch.id) return
      const tap = !touch.moved && !touch.holding
      const at = touch.ndc
      release()
      if (tap && canAct()) {
        // One swing, aimed at the tapped spot; the marker stays there a moment.
        aimTouchAt(at[0], at[1], false)
        startAction(true)
        stopAction()
      }
    }
    const touchCancel = (e) => {
      if (touch && e.pointerId === touch.id) release()
    }
    el.addEventListener('pointerdown', touchDown)
    el.addEventListener('pointermove', touchMove)
    el.addEventListener('pointerup', touchUp)
    el.addEventListener('pointercancel', touchCancel)
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('pointerleave', stopAction)
      el.removeEventListener('pointerdown', touchDown)
      el.removeEventListener('pointermove', touchMove)
      el.removeEventListener('pointerup', touchUp)
      el.removeEventListener('pointercancel', touchCancel)
      release()
      stopAction()
    }
  }, [gl])

  const cursorLook = useRef('')

  useFrame(() => {
    // Reads only: no store writes in the frame loop.
    const me = useNet.getState().me
    const slot = useUI.getState().slot
    updatePlacement(me, slot)
    // The dig preview only matters on the mountain: skip its raycast everywhere else.
    if (slot === 0 && useUI.getState().onMountain) updateAim(me)
    else aim.valid = false

    // The mouse cursor is a pickaxe on the mountain (red where you can't dig, tipped
    // forward mid-swing); an ordinary arrow everywhere else. Touch has no cursor.
    const digging = slot === 0 && useUI.getState().onMountain && !useUI.getState().modal && !localPlayer.dead
    const look = !digging ? '' : localPlayer.swing >= 0 ? 'swing' : aim.valid && !aim.problem ? 'ready' : 'blocked'
    if (look !== cursorLook.current) {
      cursorLook.current = look
      gl.domElement.style.cursor = look ? pickaxeCursor(look) : ''
    }
  })

  return <AimMarker />
}

const markerGeo = new IcosahedronGeometry(1, 1)
const markerMat = new MeshBasicMaterial({
  color: '#7fe6ff',
  wireframe: true,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  // Half of the ball is inside the ground: show it all, like an x-ray of the bite.
  depthTest: false,
  toneMapped: false,
})
/** A soft filled shell inside the wire ball, so the target reads at a glance on a phone. */
const fillMat = new MeshBasicMaterial({
  color: '#7fe6ff',
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
  depthTest: false,
  toneMapped: false,
})
const OK = new Color('#7fe6ff')
const BAD = new Color('#ff5a5a')

/**
 * Wire ball showing exactly what the next swing will carve: aim down to dig a
 * shaft, straight ahead to tunnel, up to open a ceiling. Red when it can't be dug.
 */
function AimMarker() {
  const ref = useRef(null)
  useFrame(({ clock }) => {
    const m = ref.current
    if (!m) return
    m.visible = aim.valid && aim.problem !== 'offMountain'
    if (!m.visible) return
    const pulse = 1 + Math.sin(clock.elapsedTime * 6) * 0.04
    m.position.set(aim.x, aim.my, aim.z)
    m.scale.set(aim.r * pulse, aim.sy * pulse, aim.r * pulse)
    m.rotation.y = clock.elapsedTime * 0.6
    markerMat.color.copy(aim.problem ? BAD : OK)
    fillMat.color.copy(markerMat.color)
  })
  return (
    <group ref={ref} visible={false}>
      <mesh geometry={markerGeo} material={fillMat} renderOrder={4} />
      <mesh geometry={markerGeo} material={markerMat} renderOrder={5} />
    </group>
  )
}
