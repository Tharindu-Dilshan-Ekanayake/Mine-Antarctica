import { SPAWN } from '@shared/world.js'

import { sfx } from './audio'

/**
 * Mutable per-frame state, deliberately outside React and zustand.
 *
 * The frame loop writes these every frame; React reads a throttled copy via the UI
 * ticker. Writing a store from useFrame would re-render the HUD 60x a second.
 */

export const localPlayer = {
  x: SPAWN.x,
  y: 0,
  z: SPAWN.z,
  vy: 0,
  /** Facing (radians); 0 faces +Z. */
  ry: SPAWN.ry,
  grounded: true,
  speed: 0,
  maxSpeed: 7,
  time: 0,
  /** Swing progress 0..1, or -1 when not swinging. */
  swing: -1,
  /** 0 idle, 1 walk, 2 air, 3 swing — sent to the server for remote avatars. */
  anim: 0,
  /** 0..1 cold meter; at 1 you freeze to death (Boxity's death screen, then Respawn). */
  cold: 0,
  /** Set by the controller when the player froze; the UI ticker consumes it. */
  froze: false,
  /** Frozen solid: no moving or digging until Respawn is pressed. */
  dead: false,
  /** Boxity is showing an ad: the player stands still and the cold waits. */
  paused: false,
  /** Boxity emote playing ('' for none) and when it started (performance.now() ms). */
  emote: '',
  emoteAt: 0,
  teleportRequested: false,
  /** Up/down angle of the current dig aim (radians, + is up): tilts the swing. */
  aimPitch: 0,
}

/**
 * Where the pickaxe would land right now, updated every frame from the cursor (or the
 * camera's view on touch). `valid` is false when nothing diggable is in reach.
 */
export const aim = {
  valid: false,
  /** Centre of the ball the next swing removes. */
  x: 0,
  y: 0,
  z: 0,
  /** Point on the ground surface that was hit. */
  hx: 0,
  hy: 0,
  hz: 0,
  /** Unit direction of the swing (from the chest to the hit point). */
  dx: 0,
  dy: -1,
  dz: 0,
  /** Radius of the ball one swing removes, for the preview. */
  r: 1,
  /** Centre height and vertical half-size of what the swing removes (taller for a tunnel bite). */
  my: 0,
  sy: 1,
  /** Horizontal radius of what the swing removes (wider for a tunnel bite). */
  wr: 1,
  /** Why the aimed spot can't be dug ('' if it can). */
  problem: '',
}

export function teleportHome() {
  // Frozen: only the death screen's Respawn button brings you back.
  if (localPlayer.dead) return
  localPlayer.teleportRequested = true
}

/** Back to life at base, warm again (the death screen's Respawn, once Boxity allows it). */
export function respawnPlayer() {
  sfx.respawn()
  localPlayer.dead = false
  localPlayer.cold = 0
  localPlayer.teleportRequested = true
}

/** Unified input: keyboard and touch controls both write here. */
export const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  /** Touch joystick, -1..1 each. */
  joyX: 0,
  joyY: 0,
  /** Primary action held (mouse / touch button). */
  action: false,
  /** True when the action came from touch: aim in front of the player, not at the cursor. */
  touchAim: false,
}

/** Camera orbit, written by the camera and read by movement (camera-relative WASD). */
/** 'third' (behind you) or 'first' (through your eyes): the player's choice, remembered. */
function savedCameraMode() {
  try {
    return localStorage.getItem('ma.camera') === 'first' ? 'first' : 'third'
  } catch {
    return 'third'
  }
}
export const cameraState = { yaw: 0, pitch: 0.32, distance: 11, shake: 0, dragLocked: false, close: false, mode: savedCameraMode(), eyes: false }

/** Pointer in normalised device coords, for cursor picking. */
export const pointer = { x: 0, y: 0, inside: false }

/** Garden placement preview, written by the interaction driver. */
export const placement = { active: false, valid: false, x: 0, z: 0, rot: 0, type: '', weight: 1 }
