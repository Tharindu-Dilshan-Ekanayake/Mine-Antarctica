import { Client } from '@colyseus/sdk'
import { create } from 'zustand'

import { GAME_ID } from '@shared/boxity.js'
import { closeDeathScreen } from '../bloxity/deathScreen'
import { boxityEnv } from '../bloxity/env'
import { reportPlayer, reportRoom } from '../bloxity/platform'
import { getSDK, safeCall, waitForSDK } from '../bloxity/sdk'
import { syncDigs } from '../game/terrain/heightGrid'
import { useUI } from '../store/ui'

/**
 * Colyseus connection and the read-only mirror of server state the UI renders.
 *
 * Per-frame code (players, crystals) reads `net.room.state` directly. React only
 * gets coarse snapshots, and only when a cheap signature of the relevant fields
 * actually changes, so a 20 Hz patch stream doesn't re-render the HUD 20x a second.
 *
 * Where to play: a build with VITE_LEGION_GAME_ID (hosted on Boxity) asks Boxity's
 * matchmaker for a seat on every connect - never a fixed address, and never the
 * <id>.host.bloxity.io backend, which is for HTTP only. Otherwise VITE_SERVER_URL, or
 * the game server on this page's host (local development).
 */

const ROOM_NAME = 'mine'
/** Server code for "you joined from another window". */
const DUPLICATE_LOGIN = 4100
/** Matchmaker: give up after this long (it holds a cold start ~45 s). */
const MATCHMAKER_GIVE_UP_MS = 60_000
const MATCHMAKER_BACKOFF_MS = [1000, 2000, 4000, 8000, 10000]

const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')

const defaultUrl = () => {
  if (typeof location === 'undefined') return 'ws://localhost:2567'
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.hostname}:2567`
}

/** A Boxity-hosted backend's fixed route: one pod, invisible to Boxity. Never a game socket. */
const isHostedBackend = (url) => /\.host\.(stage\.)?bloxity\.io/i.test(String(url))

/**
 * @returns {{ kind: 'matchmaker', gameId: string } | { kind: 'direct', url: string }}
 */
function serverTarget() {
  if (import.meta.env.DEV && params.get('server')) return { kind: 'direct', url: params.get('server') }
  if (import.meta.env.VITE_LEGION_GAME_ID) return { kind: 'matchmaker', gameId: import.meta.env.VITE_LEGION_GAME_ID }
  const url = import.meta.env.VITE_SERVER_URL || defaultUrl()
  if (isHostedBackend(url)) {
    console.error('[net] refusing to open the game socket to', url, '- hosted builds join through the matchmaker')
    return { kind: 'matchmaker', gameId: GAME_ID }
  }
  return { kind: 'direct', url }
}

/**
 * A room to join straight away, from the page's ?roomId= - Boxity's "Join" under Open
 * Rooms, or a friend's invite: `relay~colyseus` (as we report rooms) or a bare Colyseus
 * room id (as the room directory lists them). Used once, by the first connection.
 */
let deepLink = parseRoomId(params.get('roomId'))
/** The room we're in now: `{ relayRoomId, colyseusRoomId }`, to rejoin after signing in mid-game. */
let currentRoom = null

function parseRoomId(value) {
  if (!value) return null
  const [first, second] = String(value).split('~')
  return second ? { relayRoomId: first, colyseusRoomId: second } : { relayRoomId: null, colyseusRoomId: first }
}

/** Mutable connection handle. */
export const net = { client: null, room: null, offset: 0, mineId: 0 }

export const serverNow = () => Date.now() + net.offset

export const useNet = create(() => ({
  /** 'idle' | 'connecting' | 'online' | 'offline' | 'error' | 'replaced' */
  status: 'idle',
  error: null,
  /** What the connection is doing, while connecting ("Starting a server..."). */
  message: null,
  sessionId: null,
  roomId: null,
  me: null,
  /** [{ id, name, avatar, plot, pickaxe }] — for mounting remote avatars. */
  players: [],
  world: {
    seed: 1,
    rerollAt: 0,
    weather: '',
    weatherEndsAt: 0,
    nextWeatherAt: 0,
    restockAt: 0,
    stock: {},
    cauldron: 0,
    cauldronGoal: 400,
  },
  boards: { mined: [], cash: [] },
  /** Gardens per plot index: { owner, items } — for plot boards. */
  plots: [],
  /** Bumped when world crystals or any garden changes. */
  worldVersion: 0,
}))

/** Tiny event bus for one-shot effects (explosions, radar pings) — no React state. */
const listeners = new Map()
export function onNetEvent(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type).add(fn)
  return () => listeners.get(type)?.delete(fn)
}
function emit(type, payload) {
  listeners.get(type)?.forEach((fn) => fn(payload))
}

export function send(type, payload) {
  net.room?.send(type, payload)
}

/**
 * This browser's own guest key (signed out, or Boxity unreachable). A signed-in
 * player's save is found from their verified Boxity token instead - the server never
 * takes an account id from the client.
 */
function guestKey() {
  try {
    let key = localStorage.getItem('ma.key')
    if (!key?.startsWith('g:')) {
      key = `g:${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
      localStorage.setItem('ma.key', key)
    }
    return key
  } catch {
    return `g:${Math.random().toString(36).slice(2)}`
  }
}

const plainItem = (it) => ({
  uid: it.uid,
  kind: it.kind,
  type: it.type,
  size: it.size,
  weight: it.weight,
  mutation: it.mutation,
  value: it.value,
  luck: it.luck,
  x: it.x,
  z: it.z,
  rot: it.rot,
})

function itemsSig(list) {
  let s = ''
  for (const it of list) s += `${it.uid}${it.x | 0}${it.z | 0}${(it.rot * 10) | 0},`
  return s
}

function meSig(p) {
  return [
    p.cash, p.candy, p.warmth, p.backpackCap, p.pickaxe, p.owned.length, p.gardenSlots, p.luck,
    p.boostUntil, p.discovered.length, p.crystalsMined, p.totalSold, p.bestAlt, p.quests, p.passClaimed,
    p.plot, p.name, p.swingLvl, p.speedLvl, itemsSig(p.backpack), itemsSig(p.garden),
  ].join('|')
}

function snapshotMe(p) {
  let quests
  try {
    quests = JSON.parse(p.quests)
  } catch {
    quests = [0, 0, 0]
  }
  return {
    name: p.name,
    plot: p.plot,
    cash: p.cash,
    candy: p.candy,
    warmth: p.warmth,
    backpackCap: p.backpackCap,
    pickaxe: p.pickaxe,
    owned: [...p.owned],
    backpack: p.backpack.map(plainItem),
    garden: p.garden.map(plainItem),
    gardenSlots: p.gardenSlots,
    luck: p.luck,
    boostUntil: p.boostUntil,
    discovered: [...p.discovered],
    crystalsMined: p.crystalsMined,
    totalSold: p.totalSold,
    bestAlt: p.bestAlt,
    quests,
    passClaimed: p.passClaimed,
    swingLvl: p.swingLvl,
    speedLvl: p.speedLvl,
  }
}

const sigs = { me: '', players: '', world: '', boards: '', crystals: '', gardens: '' }

/** Session ids seen in this room, for Boxity's "your friend joined" toasts. */
const known = new Set()
let firstState = true

function reportPlayers(state, mine) {
  for (const id of known) if (!state.players.has(id)) known.delete(id)
  state.players.forEach((p, id) => {
    if (id === mine || known.has(id)) return
    known.add(id)
    reportPlayer(p.name, firstState)
  })
  firstState = false
}

function onState(state) {
  // The very first callback can come before every collection has been decoded.
  if (!state?.players || !state.digs || !state.crystals) return
  const store = useNet.getState()
  const patch = {}
  const sessionId = net.room?.sessionId

  // Terrain first: renderers and the controller read it this frame.
  syncDigs(state.seed, state.digs)

  if (state.players.size !== known.size + 1) reportPlayers(state, sessionId)

  const me = state.players.get(sessionId)
  if (me) {
    const sig = meSig(me)
    if (sig !== sigs.me) {
      sigs.me = sig
      patch.me = snapshotMe(me)
    }
  }

  let pSig = ''
  let gSig = ''
  state.players.forEach((p, id) => {
    pSig += `${id}:${p.name}:${p.plot}:${p.pickaxe}:${p.avatar.length};`
    gSig += `${p.plot}${itemsSig(p.garden)};`
  })
  if (pSig !== sigs.players) {
    sigs.players = pSig
    const players = []
    state.players.forEach((p, id) => {
      if (id !== sessionId) players.push({ id, name: p.name, avatar: p.avatar, plot: p.plot, pickaxe: p.pickaxe })
    })
    patch.players = players
  }

  let cSig = ''
  state.crystals.forEach((c, id) => {
    cSig += `${id}${c.state}${c.hp | 0}${c.owner.length};`
  })
  if (cSig !== sigs.crystals || gSig !== sigs.gardens) {
    sigs.crystals = cSig
    if (gSig !== sigs.gardens) {
      sigs.gardens = gSig
      const plots = []
      state.players.forEach((p) => {
        plots[p.plot] = { owner: p.name, luck: p.luck, slots: p.gardenSlots, items: p.garden.map(plainItem) }
      })
      patch.plots = plots
    }
    patch.worldVersion = store.worldVersion + 1
  }

  let stockSig = ''
  state.stock.forEach((v, k) => {
    stockSig += `${k}${v}`
  })
  const wSig = `${state.seed}|${state.rerollAt}|${state.weather}|${state.weatherEndsAt}|${state.nextWeatherAt}|${state.restockAt}|${stockSig}|${state.cauldron}|${state.cauldronGoal}`
  if (wSig !== sigs.world) {
    sigs.world = wSig
    const stock = {}
    state.stock.forEach((v, k) => {
      stock[k] = v
    })
    patch.world = {
      seed: state.seed,
      rerollAt: state.rerollAt,
      weather: state.weather,
      weatherEndsAt: state.weatherEndsAt,
      nextWeatherAt: state.nextWeatherAt,
      restockAt: state.restockAt,
      stock,
      cauldron: state.cauldron,
      cauldronGoal: state.cauldronGoal,
    }
  }

  let bSig = ''
  state.boardMined.forEach((r) => (bSig += `${r.name}${r.value}`))
  state.boardCash.forEach((r) => (bSig += `${r.name}${r.value}`))
  if (bSig !== sigs.boards) {
    sigs.boards = bSig
    patch.boards = {
      mined: state.boardMined.map((r) => ({ name: r.name, value: r.value })),
      cash: state.boardCash.map((r) => ({ name: r.name, value: r.value })),
    }
  }

  if (Object.keys(patch).length) useNet.setState(patch)
}

/** Who we join as: kept for rejoins (signing in mid-game, a lost room). */
let identity = null
/** Bumped by every new connection attempt; an older attempt that finishes late steps aside. */
let generation = 0
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** What a join sends: who you are, and your Boxity token (read fresh, never kept) for the server to check. */
function joinOptions() {
  const token = safeCall(() => getSDK()?.auth?.getToken?.()) || undefined
  return { key: guestKey(), name: identity.name, avatar: identity.avatar, token }
}

/**
 * Joins (or creates) an 8-player 'mine' room.
 * @param {{ name: string, avatar: string }} who
 * @param {{ rejoin?: boolean }} [opts] rejoin: the room we're in, by id (after signing in)
 */
export async function connect(who, { rejoin = false } = {}) {
  identity = who
  const status = useNet.getState().status
  if (!rejoin && (status === 'connecting' || status === 'online') && net.room) return
  const gen = ++generation
  const room = rejoin ? currentRoom : deepLink
  deepLink = null
  dropRoom()
  useNet.setState({ status: 'connecting', error: null, message: null })

  const target = serverTarget()
  try {
    const joined =
      target.kind === 'matchmaker'
        ? await joinThroughMatchmaker(gen, target.gameId, room)
        : await joinDirect(gen, target.url, room)
    if (!joined || gen !== generation) {
      joined?.room.leave(true)
      return
    }
    attachRoom(joined.room, joined.relayRoomId)
  } catch (err) {
    if (gen !== generation) return
    console.warn('[net] could not join', err)
    useNet.setState({ status: 'error', error: String(err?.message || err), message: null })
  }
}

/** Development / a server of our own: one address. A particular room first, if asked. */
async function joinDirect(gen, url, room) {
  net.client = new Client(url)
  if (room?.colyseusRoomId) {
    try {
      return { room: await net.client.joinById(room.colyseusRoomId, joinOptions()), relayRoomId: null }
    } catch (err) {
      if (gen !== generation) return null
      console.warn('[net] that room is gone or full; matchmaking instead', err)
    }
  }
  return { room: await net.client.joinOrCreate(ROOM_NAME, joinOptions()), relayRoomId: null }
}

/**
 * Hosted on Boxity: every attempt asks the matchmaker for a seat (it picks a pod with
 * room, or cold-starts one), then joins the endpoint it returns with a NEW Client -
 * each endpoint is pinned to one pod. Retries with backoff for up to a minute.
 */
async function joinThroughMatchmaker(gen, gameId, room) {
  const started = performance.now()
  // The SDK script must be in before the first matchmaker request (party play).
  const sdk = await waitForSDK().catch(() => null)
  if (gen !== generation) return null
  if (!sdk?.net?.resolveEndpoint) throw new Error('Boxity SDK unavailable')
  // A particular room first (an invite, Open Rooms' Join, a rejoin after signing in),
  // then normal matchmaking if it's gone or full.
  if (room) {
    try {
      return await joinRoomById(gameId, room)
    } catch (err) {
      if (gen !== generation) return null
      console.warn('[net] that room is gone or full; matchmaking instead', err)
    }
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { endpoint, roomId: relayRoomId } = await sdk.net.resolveEndpoint(gameId)
      if (gen !== generation) return null
      if (isHostedBackend(endpoint)) throw new Error('matchmaker returned the HTTP backend')
      net.client = new Client(endpoint)
      return { room: await net.client.joinOrCreate(ROOM_NAME, joinOptions()), relayRoomId: relayRoomId ?? null }
    } catch (err) {
      if (gen !== generation) return null
      console.warn('[net] matchmaker join failed', err)
      if (performance.now() - started > MATCHMAKER_GIVE_UP_MS) throw err
      useNet.setState({ message: attempt === 0 ? 'Starting a server...' : 'Still connecting...' })
      await wait(MATCHMAKER_BACKOFF_MS[Math.min(attempt, MATCHMAKER_BACKOFF_MS.length - 1)])
      if (gen !== generation) return null
    }
  }
}

/**
 * Joins room `room` (`{ relayRoomId, colyseusRoomId }`) by id, through the relay that
 * pins its pod - a bare joinById through any relay would land on whichever pod the
 * matchmaker picked. Without the relay, Boxity's room directory says where it is.
 */
async function joinRoomById(gameId, room) {
  const ws = (url) => String(url).replace(/^http/i, 'ws')
  const { playUrl } = boxityEnv()
  let relayRoomId = room.relayRoomId
  let url = relayRoomId ? `${ws(playUrl)}/v1/ws/${relayRoomId}` : null
  if (!url) {
    const res = await fetch(`${playUrl}/v1/dir/${encodeURIComponent(gameId)}/list`, { signal: AbortSignal.timeout(6000) })
    const listed = (await res.json())?.rooms ?? []
    const found = listed.find((r) => [r.colyseusRoomId, r.roomId, r.id].includes(room.colyseusRoomId))
    if (!found) throw new Error('room not listed')
    relayRoomId = found.relayRoomId ?? found.relayId ?? null
    url = found.joinUrl ? ws(found.joinUrl) : relayRoomId ? `${ws(playUrl)}/v1/ws/${relayRoomId}` : null
    if (!url) throw new Error('no way into that room')
    relayRoomId ??= /\/v1\/ws\/([^/?#]+)/.exec(url)?.[1] ?? null
  }
  net.client = new Client(url)
  return { room: await net.client.joinById(room.colyseusRoomId, joinOptions()), relayRoomId }
}

/** Set when we leave on purpose, so onLeave doesn't rejoin. */
let leaving = false

/**
 * Wires a joined room into the game. Through Boxity's matchmaker, `relayRoomId` is the
 * relay pinning its pod; with it, the room is reported to Boxity as `relay~colyseus`,
 * which is what invites and rejoins need.
 */
function attachRoom(room, relayRoomId) {
  net.room = room
  leaving = false
  for (const k of Object.keys(sigs)) sigs[k] = ''
  known.clear()
  firstState = true
  currentRoom = { relayRoomId, colyseusRoomId: room.roomId }
  reportRoom(relayRoomId ? `${relayRoomId}~${room.roomId}` : room.roomId)
  useNet.setState({ status: 'online', sessionId: room.sessionId, roomId: room.roomId, message: null })

  room.onStateChange(onState)
  room.onMessage('hello', ({ now, mineId }) => {
    net.offset = now - Date.now()
    // The id the server stamps on every ball you dig: how the map tells yours apart.
    net.mineId = mineId ?? 0
  })
  room.onMessage('toast', ({ text, kind }) => useUI.getState().toast(text, kind))
  room.onMessage('found', (m) => emit('found', m))
  room.onMessage('discovered', (m) => emit('discovered', m))
  room.onMessage('sold', (m) => emit('sold', m))
  room.onMessage('bomb', (m) => emit('bomb', m))
  room.onMessage('boom', (m) => emit('boom', m))
  room.onMessage('radar', (m) => emit('radar', m))
  room.onDrop?.(() => useNet.setState({ status: 'connecting', message: 'Reconnecting...' }))
  room.onReconnect?.(() => useNet.setState({ status: 'online', message: null }))
  room.onLeave((code) => {
    if (net.room !== room) return
    net.room = null
    reportRoom('')
    if (code === DUPLICATE_LOGIN) {
      closeDeathScreen()
      useNet.setState({ status: 'replaced', message: null })
      return
    }
    if (leaving) {
      useNet.setState({ status: 'offline' })
      return
    }
    // Lost the room for good (server restart, reconnect window missed): find a seat again.
    useNet.setState({ status: 'connecting', message: 'Reconnecting...' })
    setTimeout(() => identity && !net.room && connect(identity, { rejoin: false }), 1500)
  })
  room.onError((code, message) => console.warn('[net] room error', code, message))
}

function dropRoom() {
  const room = net.room
  if (!room) return
  leaving = true
  net.room = null
  room.leave(true)
}

/**
 * Signed in (or out) mid-game: rejoin the SAME room by id with the new identity, so a
 * player stays with their friends. Normal matchmaking only if that room is gone.
 */
export function rejoinAsNewIdentity(who) {
  if (!net.room) return
  connect(who, { rejoin: true })
}

/** Takes the game back after another window of the same account replaced this one. */
export function playHere() {
  if (identity) connect(identity)
}

export function leave() {
  dropRoom()
}
