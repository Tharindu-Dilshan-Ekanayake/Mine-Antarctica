import { Room } from 'colyseus'

import {
  BOMB_BY_ID,
  BOMBS,
  BLOODMOON,
  CAULDRON_GOAL,
  CRYSTAL_BY_ID,
  crystalHp,
  crystalLuck,
  crystalValue,
  gardenSlotCost,
  MAX_GARDEN_SLOTS,
  MUTATIONS,
  PASS_TIERS,
  PICKAXE_BY_ID,
  QUESTS,
  questReward,
  questTarget,
  RADAR_BY_ID,
  RADARS,
  REROLL_SECONDS,
  RESTOCK_SECONDS,
  rollCrystal,
  SIZES,
  sizeRangeAtDepth,
  START,
  LEVEL_UPGRADES,
  levelSeries,
  swingTime,
  upgradeCost,
  WEATHER_BY_ID,
  WEATHER_TIMING,
  WEATHERS,
} from '../../shared/catalog.js'
import { pickWeighted } from '../../shared/rng.js'
import {
  baseHeight,
  digBalls,
  digProblem,
  digRadius,
  isDiggable,
  MAX_PLAYERS,
  MOUNTAIN,
  PLOT_SIZE,
  PLOTS,
  plotContains,
  REACH,
  SPAWN,
  STALLS,
  zoneIndexAt,
} from '../../shared/world.js'
import { noteScore, verifyPlayerToken } from './boxity.js'
import { adoptGuest, allProfiles, fetchProfile, flushProfiles, loadProfile, saveProfile } from './profiles.js'
import { BoardRow, Crystal, Dig, Item, MineState, Player } from './schema.js'

/** Hard cap on recorded craters per mountain; each one replays on every join. */
const MAX_DIGS = 9000
const MAX_WORLD_CRYSTALS = 160
/** Chance a plain pickaxe swing turns up a crystal. */
const FIND_CHANCE = 0.17
/** Finds that come easy for a brand-new miner. */
const BEGINNER_FINDS = 5
/** Largest size band a beginner finds: Small (up to 6 kg), always light enough for the bag. */
const BEGINNER_MAX_SIZE = 1
const LOOSE_TTL_MS = 5 * 60 * 1000
/** A found crystal belongs to its finder for this long, then anyone may grab it. */
const OWNER_LOCK_MS = 60 * 1000
const SELL_STALL = STALLS.find((s) => s.id === 'sell')
const BOMB_FUSE_MS = 1600

const rand = Math.random
const finite = (n) => typeof n === 'number' && Number.isFinite(n)
/** A small stable id for a save key (1..65535): lets clients tell whose digs are whose. */
const ownerId = (key) => {
  let h = 2166136261
  for (let i = 0; i < key.length; i += 1) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return ((h >>> 0) % 65535) + 1
}
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2
const dist3 = (ax, ay, az, bx, by, bz) => (ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2

let uidCounter = 0
const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}`

function cleanString(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max)
}

/** Every room open on this server, for the leaderboard reporter and shutdown. */
export const liveRooms = new Set()
/** Profile key -> { room, client } of everyone playing on this server, one session each. */
const activeKeys = new Map()
/** Whether `key` belongs to someone playing on this pod (storage keeps their save in memory). */
export const isKeyActive = (key) => activeKeys.has(key)
/** Close code for "you joined from another window". */
export const DUPLICATE_LOGIN = 4100

/** Profile keys: `bx:<account id>` for a verified Boxity player, `g:<random>` for our own guests. */
const accountKey = (userId) => `bx:${userId}`

export class MineRoom extends Room {
  maxClients = MAX_PLAYERS
  patchRate = 50
  maxMessagesPerSecond = 80

  /** sessionId -> server-only bookkeeping (profile key, cooldowns). */
  meta = new Map()
  /** crystal id -> { born, looseAt } */
  crystalMeta = new Map()
  crystalCounter = 0

  onCreate() {
    liveRooms.add(this)
    this.state = new MineState()
    const now = Date.now()
    this.state.seed = 1 + Math.floor(rand() * 1e6)
    this.state.rerollAt = now + REROLL_SECONDS * 1000
    this.state.nextWeatherAt = now + 90 * 1000
    this.state.cauldronGoal = CAULDRON_GOAL
    this.restock(now)

    this.clock.setInterval(() => this.tick(), 1000)
    this.clock.setInterval(() => this.updateBoards(), 15000)
    this.clock.setInterval(() => this.saveAll(), 20000)
    this.updateBoards()

    this.onMessage('move', (client, m) => this.onMove(client, m))
    this.onMessage('dig', (client, m) => this.onDig(client, m))
    this.onMessage('hit', (client, m) => this.onHit(client, m))
    this.onMessage('pickup', (client, m) => this.onPickup(client, m))
    this.onMessage('sell', (client, m) => this.onSell(client, m))
    this.onMessage('buyPickaxe', (client, m) => this.onBuyPickaxe(client, m))
    this.onMessage('buyUpgrade', (client, m) => this.onBuyUpgrade(client, m))
    this.onMessage('buyGardenSlot', (client) => this.onBuyGardenSlot(client))
    this.onMessage('buyItem', (client, m) => this.onBuyItem(client, m))
    this.onMessage('useItem', (client, m) => this.onUseItem(client, m))
    this.onMessage('place', (client, m) => this.onPlace(client, m))
    this.onMessage('takeOut', (client, m) => this.onTakeOut(client, m))
    this.onMessage('sortGarden', (client) => this.onSortGarden(client))
    this.onMessage('deposit', (client, m) => this.onDeposit(client, m))
    this.onMessage('claimQuest', (client, m) => this.onClaimQuest(client, m))
    this.onMessage('claimPass', (client) => this.onClaimPass(client))
    // A Boxity emote picked (or '' when it stopped): everyone sees it from the state.
    this.onMessage('emote', (client, m) => {
      const player = this.playerOf(client)
      const id = String(m?.id ?? '')
      if (!player || (id && !/^[a-z0-9]{1,32}$/i.test(id))) return
      player.emote = id
      player.emoteAt = id ? Date.now() : 0
    })
    // Avatar / display name changed after joining (e.g. logged in mid-session).
    this.onMessage('identity', (client, m) => {
      const player = this.playerOf(client)
      if (!player) return
      player.avatar = cleanString(m?.avatar, 4000)
      const name = cleanString(m?.name, 24)
      if (name) player.name = name
    })
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Who's joining. A Boxity token, checked with Boxity, names the account whose save is
   * loaded - and carries a Boxity guest's progress into it if the account has none yet.
   * With no token (or Boxity unreachable), the per-browser guest key the client brought,
   * which can only ever reach its own guest save. Only verified players count towards
   * Boxity's leaderboards.
   */
  async onAuth(_client, options = {}) {
    const verified = await verifyPlayerToken(options.token)
    if (verified) {
      const userId = String(verified.user._id)
      const key = accountKey(userId)
      // The save comes from the database before the player is let in (onJoin reads it
      // from memory); a guest's carried progress is looked up first, so it can follow.
      const existing = await fetchProfile(key)
      if (!existing && verified.carriedFrom.length) {
        const guestKeys = verified.carriedFrom.filter((id) => id !== userId).map(accountKey)
        await Promise.all(guestKeys.map((k) => fetchProfile(k)))
        const from = adoptGuest(key, guestKeys)
        if (from) console.log(`[room] carried guest ${from}'s progress into ${key}`)
      }
      return { key, userId, name: verified.user.displayName || verified.user.username || '' }
    }
    // Unverified: only a guest key - never someone's account.
    const raw = cleanString(options.key, 80)
    const guest = raw.startsWith('g:') ? raw : ''
    if (guest) await fetchProfile(guest)
    return { key: guest, userId: '', name: '' }
  }

  onJoin(client, options = {}, auth = client.auth) {
    const key = auth?.key || `s:${client.sessionId}`
    const userId = auth?.userId || ''

    // Same account (or browser) joining again - a refresh, a new tab, a reconnect the old
    // session hasn't noticed yet: the newest connection wins. The old one is saved now
    // and closed, so a frozen copy of the player doesn't hold a plot.
    const existing = activeKeys.get(key)
    if (existing) existing.room.evict(existing.client)

    const profile = loadProfile(key)
    const player = new Player()

    player.name = cleanString(options.name, 24) || cleanString(auth?.name, 24) || profile?.name || 'Guest'
    player.uid = userId
    player.avatar = cleanString(options.avatar, 4000)
    player.plot = this.freePlot()
    player.x = SPAWN.x + (rand() - 0.5) * 6
    player.z = SPAWN.z + (rand() - 0.5) * 4
    player.ry = SPAWN.ry
    this.applyProfile(player, profile)

    this.state.players.set(client.sessionId, player)
    this.meta.set(client.sessionId, { key, userId, owner: ownerId(key), lastSwing: 0, lastHit: 0 })
    activeKeys.set(key, { room: this, client })

    client.send('hello', { now: Date.now(), mineId: ownerId(key) })
    this.broadcast('toast', { text: `${player.name} joined the expedition`, kind: 'info' }, { except: client })
  }

  onLeave(client) {
    const player = this.state.players.get(client.sessionId)
    const meta = this.meta.get(client.sessionId)
    if (player && meta && !meta.evicted) {
      saveProfile(meta.key, this.toProfile(player))
      this.noteScore(meta, player)
    }
    if (meta && activeKeys.get(meta.key)?.client === client) activeKeys.delete(meta.key)
    // Their save goes to the database now, not at the next timer: another pod may be
    // about to load it.
    void flushProfiles()
    for (const crystal of this.state.crystals.values()) {
      if (crystal.owner === client.sessionId) crystal.owner = ''
    }
    this.state.players.delete(client.sessionId)
    this.meta.delete(client.sessionId)
  }

  onDispose() {
    this.saveAll()
    this.collectScores()
    liveRooms.delete(this)
  }

  /** Saves and closes a session whose player has joined again somewhere else. */
  evict(client) {
    const meta = this.meta.get(client.sessionId)
    const player = this.state.players.get(client.sessionId)
    if (meta && player) {
      saveProfile(meta.key, this.toProfile(player))
      this.noteScore(meta, player)
      // Saved here: the later onLeave mustn't write this (now stale) copy over the new session's.
      meta.evicted = true
    }
    client.leave(DUPLICATE_LOGIN, 'You joined from another window.')
  }

  /** Hands a verified player's score to the Boxity leaderboard reporter. */
  noteScore(meta, player) {
    if (meta.userId) noteScore(meta.userId, player.crystalsMined)
  }

  /** Everyone's scores here, for the reporter's next report. */
  collectScores() {
    for (const [sessionId, player] of this.state.players) {
      const meta = this.meta.get(sessionId)
      if (meta) this.noteScore(meta, player)
    }
  }

  freePlot() {
    const used = new Set([...this.state.players.values()].map((p) => p.plot))
    for (let i = 0; i < PLOTS.length; i += 1) if (!used.has(i)) return i
    return 0
  }

  applyProfile(player, profile) {
    const p = profile ?? {}
    player.cash = p.cash ?? START.cash
    player.candy = p.candy ?? 0
    player.warmth = p.warmth ?? START.warmth
    player.backpackCap = p.backpackCap ?? START.backpack
    player.gardenSlots = p.gardenSlots ?? START.gardenSlots
    player.pickaxe = PICKAXE_BY_ID[p.pickaxe] ? p.pickaxe : 'rusted'
    for (const id of p.owned ?? ['rusted']) if (PICKAXE_BY_ID[id]) player.owned.push(id)
    if (!player.owned.includes('rusted')) player.owned.push('rusted')
    for (const it of p.backpack ?? []) player.backpack.push(new Item(it))
    for (const it of p.garden ?? []) player.garden.push(new Item(it))
    for (const id of p.discovered ?? []) if (CRYSTAL_BY_ID[id]) player.discovered.push(id)
    player.crystalsMined = p.crystalsMined ?? 0
    player.totalSold = p.totalSold ?? 0
    player.bestAlt = p.bestAlt ?? 0
    player.quests = typeof p.quests === 'string' ? p.quests : '[0,0,0]'
    player.passClaimed = p.passClaimed ?? 0
    player.swingLvl = Math.min(LEVEL_UPGRADES.swing.max, p.swingLvl ?? 0)
    player.speedLvl = Math.min(LEVEL_UPGRADES.speed.max, p.speedLvl ?? 0)
    // Garden items keep their spot relative to whichever plot the player gets now.
    const plot = PLOTS[player.plot]
    // The saved plot's centre (older profiles: its index) moves the garden as a whole;
    // then everything is kept inside the plot, in case the base layout has changed.
    const from = p.plotX !== undefined ? { x: p.plotX, z: p.plotZ } : PLOTS[p.plotIndex] ?? plot
    const half = PLOT_SIZE / 2 - 1
    for (const it of player.garden) {
      it.x = Math.max(plot.x - half, Math.min(plot.x + half, it.x - from.x + plot.x))
      it.z = Math.max(plot.z - half, Math.min(plot.z + half, it.z - from.z + plot.z))
    }
    this.recomputeLuck(player)
  }

  toProfile(player) {
    const plain = (it) => ({
      uid: it.uid, kind: it.kind, type: it.type, size: it.size, weight: it.weight,
      mutation: it.mutation, value: it.value, luck: it.luck, x: it.x, z: it.z, rot: it.rot,
    })
    return {
      name: player.name,
      cash: player.cash,
      candy: player.candy,
      warmth: player.warmth,
      backpackCap: player.backpackCap,
      gardenSlots: player.gardenSlots,
      pickaxe: player.pickaxe,
      owned: [...player.owned],
      backpack: player.backpack.map(plain),
      garden: player.garden.map(plain),
      plotIndex: player.plot,
      plotX: PLOTS[player.plot].x,
      plotZ: PLOTS[player.plot].z,
      discovered: [...player.discovered],
      crystalsMined: player.crystalsMined,
      totalSold: player.totalSold,
      bestAlt: player.bestAlt,
      quests: player.quests,
      passClaimed: player.passClaimed,
      swingLvl: player.swingLvl,
      speedLvl: player.speedLvl,
    }
  }

  saveAll() {
    for (const [sessionId, player] of this.state.players) {
      const meta = this.meta.get(sessionId)
      if (meta && !meta.evicted) saveProfile(meta.key, this.toProfile(player))
    }
  }

  // ---------------------------------------------------------------------------
  // World clock: mountain reroll, weather, restock, crystal expiry
  // ---------------------------------------------------------------------------

  tick() {
    const now = Date.now()
    const s = this.state

    if (now >= s.rerollAt) {
      s.seed = 1 + Math.floor(rand() * 1e6)
      s.digs.clear()
      s.crystals.clear()
      this.crystalMeta.clear()
      s.rerollAt = now + REROLL_SECONDS * 1000
      this.broadcast('toast', { text: 'A NEW Antarctic mining zone has formed!', kind: 'good' })
    }

    if (s.weather && now >= s.weatherEndsAt) {
      s.weather = ''
    }
    if (!s.weather && now >= s.nextWeatherAt) {
      const weights = [...WEATHERS.map((w) => w.chance), 12]
      const pick = pickWeighted(weights, rand())
      if (pick < WEATHERS.length) this.startWeather(WEATHERS[pick].id, WEATHER_TIMING.duration, now)
      s.nextWeatherAt = now + WEATHER_TIMING.cycle * 1000
    }

    if (now >= s.restockAt) this.restock(now)

    for (const [id, crystal] of s.crystals) {
      const meta = this.crystalMeta.get(id)
      if (crystal.state === 1 && meta?.looseAt && now - meta.looseAt > LOOSE_TTL_MS) {
        s.crystals.delete(id)
        this.crystalMeta.delete(id)
      } else if (crystal.owner && meta?.looseAt && now - meta.looseAt > OWNER_LOCK_MS) {
        crystal.owner = ''
      }
    }
  }

  startWeather(id, seconds, now = Date.now()) {
    const w = WEATHER_BY_ID[id]
    if (!w) return
    this.state.weather = id
    this.state.weatherEndsAt = now + seconds * 1000
    this.broadcast('toast', { text: `${w.name} is sweeping the mountain! (${w.mutation})`, kind: 'good' })
  }

  restock(now) {
    // The cheapest of each is always stocked; rarer ones only sometimes.
    BOMBS.forEach((b, i) => this.state.stock.set(`bomb:${b.id}`, i === 0 || rand() < 0.6 ? b.stock : 0))
    RADARS.forEach((r, i) => this.state.stock.set(`radar:${r.id}`, i === 0 || rand() < 0.55 ? r.stock : 0))
    this.state.restockAt = now + RESTOCK_SECONDS * 1000
  }

  updateBoards() {
    const rows = new Map()
    for (const p of allProfiles()) rows.set(p.name + p.savedAt, p)
    for (const [sessionId, player] of this.state.players) {
      rows.set(`live:${sessionId}`, { name: player.name, crystalsMined: player.crystalsMined, cash: player.cash })
    }
    // A live player also has a saved profile; keep the best row per name.
    const byName = new Map()
    for (const r of rows.values()) {
      const prev = byName.get(r.name)
      if (!prev || (r.crystalsMined ?? 0) + (r.cash ?? 0) >= (prev.crystalsMined ?? 0) + (prev.cash ?? 0)) {
        byName.set(r.name, r)
      }
    }
    const list = [...byName.values()]
    const fill = (target, key) => {
      const top = [...list].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, 8)
      target.clear()
      for (const r of top) target.push(new BoardRow({ name: r.name, value: r[key] ?? 0 }))
    }
    fill(this.state.boardMined, 'crystalsMined')
    fill(this.state.boardCash, 'cash')
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  toast(client, text, kind = 'error') {
    client.send('toast', { text, kind })
  }

  carried(player) {
    let total = 0
    for (const it of player.backpack) total += it.weight
    return total
  }

  recomputeLuck(player) {
    let luck = 0
    for (const it of player.garden) luck += it.luck
    player.luck = Math.round(luck * 10) / 10
  }

  luckMultiplier(player, now) {
    let mult = 1 + player.luck / 100
    if (player.boostUntil > now) mult *= 3
    if (this.state.weather === 'lucky') mult *= 2
    return mult
  }

  /** Mutation for a freshly found crystal, from the active weather. */
  rollMutation(forced, forcedChance = 1) {
    if (forced && rand() < forcedChance) return forced
    const w = WEATHER_BY_ID[this.state.weather]
    if (w && rand() < WEATHER_TIMING.mutateChance) return w.mutation
    return ''
  }

  /** Creates a crystal in the world. Returns it, or null when the world is full. */
  spawnCrystal({ x, y, z, player, sessionId, minRarity = 0, weightMult = 1, mutation = '', luckMult = 1, state = 0, maxSize, anyDepth = false }) {
    const s = this.state
    if (s.crystals.size >= MAX_WORLD_CRYSTALS) {
      // Drop the oldest unowned loose crystal to make room; give up otherwise.
      let oldest = null
      for (const [id, c] of s.crystals) {
        if (c.state === 1 && !c.owner) {
          const born = this.crystalMeta.get(id)?.born ?? 0
          if (!oldest || born < oldest.born) oldest = { id, born }
        }
      }
      if (!oldest) return null
      s.crystals.delete(oldest.id)
      this.crystalMeta.delete(oldest.id)
    }

    // Rarity follows the altitude you actually dug at, so deep tunnels are poorer.
    const zone = zoneIndexAt(Math.min(y, baseHeight(x, z, s.seed)))
    // Size follows depth: small crystals near the entrance, bigger and heavier the deeper
    // into the mountain you dig (radars, which bury theirs at the surface, ignore this).
    let sizeMax = maxSize ?? SIZES.length - 1
    let sizeMin = 0
    if (!anyDepth) {
      const band = sizeRangeAtDepth(baseHeight(x, z, s.seed) - y)
      sizeMax = Math.min(sizeMax, band.max)
      sizeMin = Math.min(band.min, sizeMax)
    }
    const roll = rollCrystal(rand, zone, luckMult, minRarity, sizeMax, sizeMin)
    const weight = Math.round(roll.weight * weightMult * 10) / 10
    const id = `c${(this.crystalCounter++).toString(36)}`
    const hp = crystalHp(roll.typeId, roll.sizeIndex)
    const crystal = new Crystal({
      type: roll.typeId,
      size: roll.sizeIndex,
      weight,
      mutation,
      value: crystalValue(roll.typeId, weight, mutation),
      luck: crystalLuck(roll.typeId, weight, mutation),
      x,
      y,
      z,
      rot: rand() * Math.PI * 2,
      hp,
      maxHp: hp,
      state,
      owner: sessionId,
      ownerName: player?.name ?? '',
    })
    s.crystals.set(id, crystal)
    this.crystalMeta.set(id, { born: Date.now(), looseAt: state === 1 ? Date.now() : 0 })
    return crystal
  }

  /** Random diggable point within [minR, maxR] of (x, z), or null. */
  findDiggableNear(x, z, minR, maxR) {
    for (let i = 0; i < 24; i += 1) {
      const a = rand() * Math.PI * 2
      const r = minR + rand() * (maxR - minR)
      const px = x + Math.cos(a) * r
      const pz = z + Math.sin(a) * r
      if (isDiggable(px, pz, this.state.seed)) return { x: px, z: pz }
    }
    return null
  }

  playerOf(client) {
    return this.state.players.get(client.sessionId)
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  onMove(client, m) {
    const player = this.playerOf(client)
    if (!player || !m || !finite(m.x) || !finite(m.y) || !finite(m.z) || !finite(m.ry)) return
    // Movement is client-predicted; the server only keeps it inside the world.
    const reach = MOUNTAIN.half + 60
    player.x = Math.max(MOUNTAIN.cx - reach, Math.min(MOUNTAIN.cx + reach, m.x))
    player.y = Math.max(MOUNTAIN.bedrock - 8, Math.min(MOUNTAIN.peak + 40, m.y))
    player.z = Math.max(MOUNTAIN.cz - reach, Math.min(300, m.z))
    player.ry = m.ry
    player.anim = Math.max(0, Math.min(3, m.anim | 0))
    if (player.y > player.bestAlt && player.y <= MOUNTAIN.peak + 5) player.bestAlt = Math.floor(player.y)
  }

  onDig(client, m) {
    const player = this.playerOf(client)
    const meta = this.meta.get(client.sessionId)
    if (!player || !meta || !m || !finite(m.x) || !finite(m.y) || !finite(m.z)) return
    const now = Date.now()
    if (now - meta.lastSwing < swingTime(player.swingLvl) * 1000 * 0.8) return
    meta.lastSwing = now

    const pickaxe = PICKAXE_BY_ID[player.pickaxe]
    const radius = digRadius(pickaxe)
    // Reach is measured in 3D from the chest: you can dig up, down and sideways.
    if (dist3(player.x, player.y + 1.2, player.z, m.x, m.y, m.z) > (REACH + radius + 1.5) ** 2) return
    // A level swing at the wall in front of you opens a walk-in tunnel (see digBalls).
    const balls = digBalls(m.x, m.y, m.z, finite(m.dy) ? m.dy : -1, radius, player.y)
    const carve = balls.filter((b) => !digProblem(b.x, b.y, b.z, b.r, this.state.seed))
    const problem = carve.length ? '' : digProblem(m.x, m.y, m.z, radius, this.state.seed) || 'air'
    if (problem) {
      const why = {
        offMountain: 'You can only dig at the mountain! Go there \u26cf\ufe0f',
        bedrock: 'Bedrock! You can\'t dig any deeper here',
        tooDeep: 'Too deep! The mountain is frozen solid down here',
        air: 'Nothing to break here \u26cf\ufe0f',
      }[problem]
      this.toast(client, why, 'warn')
      return
    }
    if (this.state.digs.length + carve.length > MAX_DIGS) {
      this.toast(client, 'This mountain is dug out - wait for the next Mountain RNG!', 'warn')
      return
    }

    for (const b of carve) this.state.digs.push(new Dig({ x: b.x, y: b.y, z: b.z, r: b.r, by: meta.owner }))

    // Finds sit just past the hole, in the direction you were digging.
    let dx = finite(m.dx) ? m.dx : 0
    let dy = finite(m.dy) ? m.dy : -1
    let dz = finite(m.dz) ? m.dz : 0
    const dl = Math.hypot(dx, dy, dz) || 1
    dx /= dl
    dy /= dl
    dz /= dl

    const luckMult = this.luckMultiplier(player, now)
    // Luck nudges the find chance a little, not just the rarity.
    let chance = Math.min(0.5, FIND_CHANCE * (1 + Math.log10(luckMult) * 0.5))
    // Brand-new miners (the first-time guide asks for two crystals) find their first
    // few quickly, so the first minute is about the fun part, not waiting.
    const beginner = player.crystalsMined + player.backpack.length < BEGINNER_FINDS
    if (beginner) chance = Math.max(chance, 0.5)
    if (rand() < chance) {
      const crystal = this.spawnCrystal({
        x: m.x + dx * radius * 0.85 + (rand() - 0.5) * radius * 0.4,
        y: Math.max(MOUNTAIN.bedrock + 0.3, m.y + dy * radius * 0.85),
        z: m.z + dz * radius * 0.85 + (rand() - 0.5) * radius * 0.4,
        player,
        sessionId: client.sessionId,
        luckMult,
        mutation: this.rollMutation(),
        // A new miner's first finds are small ones: a heavy crystal that won't fit the
        // bag is just confusing on the very first dig.
        maxSize: beginner ? BEGINNER_MAX_SIZE : undefined,
      })
      if (crystal) {
        player.candy += 1 + Math.floor(rand() * 2)
        client.send('found', { type: crystal.type, size: crystal.size, weight: crystal.weight, mutation: crystal.mutation })
      }
    }
  }

  onHit(client, m) {
    const player = this.playerOf(client)
    const meta = this.meta.get(client.sessionId)
    const crystal = this.state.crystals.get(m?.id)
    if (!player || !meta || !crystal || crystal.state !== 0) return
    const now = Date.now()
    if (now - meta.lastHit < swingTime(player.swingLvl) * 1000 * 0.8) return
    meta.lastHit = now
    if (dist3(player.x, player.y + 1.2, player.z, crystal.x, crystal.y, crystal.z) > (REACH + 3) ** 2) return

    const pickaxe = PICKAXE_BY_ID[player.pickaxe]
    crystal.hp = Math.max(0, crystal.hp - pickaxe.power * (0.85 + rand() * 0.3))
    if (crystal.hp <= 0) {
      crystal.state = 1
      // It pops out of the wall toward whoever freed it, into the open tunnel,
      // then settles on the ground below (the client finds the floor).
      crystal.x += (player.x - crystal.x) * 0.45
      crystal.z += (player.z - crystal.z) * 0.45
      crystal.y += (player.y + 1 - crystal.y) * 0.5
      const cm = this.crystalMeta.get(m.id)
      if (cm) cm.looseAt = now
      // Whoever freed it gets first claim.
      if (!crystal.owner) {
        crystal.owner = client.sessionId
        crystal.ownerName = player.name
      }
    }
  }

  onPickup(client, m) {
    const player = this.playerOf(client)
    const crystal = this.state.crystals.get(m?.id)
    if (!player || !crystal || crystal.state !== 1) return
    // Loose crystals rest below where they were freed, so allow a tall reach.
    if (dist2(player.x, player.z, crystal.x, crystal.z) > 7 * 7 || Math.abs(player.y - crystal.y) > 14) return
    if (crystal.owner && crystal.owner !== client.sessionId) {
      this.toast(client, `This crystal belongs to ${crystal.ownerName}!`)
      return
    }
    if (this.carried(player) + crystal.weight > player.backpackCap + 1e-6) {
      this.toast(client, 'Backpack full! Upgrade at UPGRADES or sell at SELL')
      return
    }
    player.backpack.push(
      new Item({
        uid: newUid(),
        kind: 'crystal',
        type: crystal.type,
        size: crystal.size,
        weight: crystal.weight,
        mutation: crystal.mutation,
        value: crystal.value,
        luck: crystal.luck,
      }),
    )
    if (!player.discovered.includes(crystal.type)) {
      player.discovered.push(crystal.type)
      client.send('discovered', { type: crystal.type })
    }
    player.crystalsMined += 1
    this.state.crystals.delete(m.id)
    this.crystalMeta.delete(m.id)
  }

  onSell(client, m) {
    const player = this.playerOf(client)
    if (!player) return
    if (dist2(player.x, player.z, SELL_STALL.x, SELL_STALL.z) > 12 * 12) {
      this.toast(client, 'Go to the SELL stall to sell crystals')
      return
    }
    let amount = 0
    let count = 0
    for (let i = player.backpack.length - 1; i >= 0; i -= 1) {
      const it = player.backpack[i]
      if (it.kind !== 'crystal') continue
      if (m?.mode === 'one' && it.uid !== m.uid) continue
      amount += it.value
      count += 1
      player.backpack.splice(i, 1)
    }
    if (!count) {
      this.toast(client, 'You have no crystals to sell')
      return
    }
    player.cash += amount
    player.totalSold += amount
    client.send('sold', { amount, count })
  }

  onBuyPickaxe(client, m) {
    const player = this.playerOf(client)
    const pick = PICKAXE_BY_ID[m?.id]
    if (!player || !pick) return
    if (player.owned.includes(pick.id)) {
      player.pickaxe = pick.id
      return
    }
    if (m.currency === 'candy') {
      if (player.candy < pick.candy) return this.toast(client, 'Not enough candy corn!')
      player.candy -= pick.candy
    } else {
      if (player.cash < pick.price) return this.toast(client, 'Not enough cash!')
      player.cash -= pick.price
    }
    player.owned.push(pick.id)
    player.pickaxe = pick.id
    client.send('toast', { text: `Equipped ${pick.name}!`, kind: 'good' })
  }

  onBuyUpgrade(client, m) {
    const player = this.playerOf(client)
    if (!player) return
    if (m?.kind === 'swing' || m?.kind === 'speed') return this.buyLevels(client, player, m)
    if (m?.kind !== 'warmth' && m?.kind !== 'backpack') return
    const field = m.kind === 'warmth' ? 'warmth' : 'backpackCap'
    const from = Math.round(player[field])
    let count
    let cost
    if (m.amount === 'max') {
      const r = m.kind === 'warmth' ? upgradeCost.warmthMax(from, player.cash) : upgradeCost.backpackMax(from, player.cash)
      count = r.count
      cost = r.cost
    } else {
      count = Math.max(1, Math.min(100000, Math.floor(Number(m.amount) || 0)))
      cost = upgradeCost[m.kind](from, count)
    }
    if (count <= 0 || cost > player.cash) return this.toast(client, 'Not enough cash!')
    player.cash -= cost
    player[field] = from + count
    client.send('toast', { text: `+${count}${m.kind === 'warmth' ? ' warmth' : ' kg'}!`, kind: 'good' })
  }

  /** Mine Faster / Run Faster: `amount` levels (or 'max' affordable), up to the cap. */
  buyLevels(client, player, m) {
    const field = m.kind === 'swing' ? 'swingLvl' : 'speedLvl'
    const level = player[field]
    if (level >= LEVEL_UPGRADES[m.kind].max) return this.toast(client, 'Already maxed out!')
    const want = m.amount === 'max' ? Infinity : Math.max(1, Math.min(50, Math.floor(Number(m.amount) || 1)))
    const { count, cost } = levelSeries(m.kind, level, player.cash, want)
    if (count <= 0 || cost > player.cash) return this.toast(client, 'Not enough cash!')
    player.cash -= cost
    player[field] = level + count
    const label = m.kind === 'swing' ? 'Mine Faster' : 'Run Faster'
    client.send('toast', { text: `${label} level ${player[field]}!`, kind: 'good' })
  }

  onBuyGardenSlot(client) {
    const player = this.playerOf(client)
    if (!player) return
    if (player.gardenSlots >= MAX_GARDEN_SLOTS) return this.toast(client, 'Your garden is at max size!')
    const cost = gardenSlotCost(player.gardenSlots)
    if (player.cash < cost) return this.toast(client, 'Not enough cash!')
    player.cash -= cost
    player.gardenSlots += 1
  }

  onBuyItem(client, m) {
    const player = this.playerOf(client)
    if (!player) return
    const def = m?.kind === 'bomb' ? BOMB_BY_ID[m.id] : m?.kind === 'radar' ? RADAR_BY_ID[m.id] : null
    if (!def) return
    const key = `${m.kind}:${def.id}`
    const stock = this.state.stock.get(key) ?? 0
    if (stock <= 0) return this.toast(client, 'No stock! Wait for the restock')
    if (player.cash < def.price) return this.toast(client, 'Not enough cash!')
    player.cash -= def.price
    this.state.stock.set(key, stock - 1)
    player.backpack.push(new Item({ uid: newUid(), kind: m.kind, type: def.id }))
    client.send('toast', { text: `Bought ${def.name}!`, kind: 'good' })
  }

  onUseItem(client, m) {
    const player = this.playerOf(client)
    if (!player || !m) return
    const index = player.backpack.findIndex((it) => it.uid === m.uid)
    if (index < 0) return
    const item = player.backpack[index]
    const now = Date.now()

    if (item.kind === 'bomb') {
      const bomber = this.meta.get(client.sessionId)?.owner ?? 0
      const bomb = BOMB_BY_ID[item.type]
      if (!bomb || !finite(m.x) || !finite(m.z)) return
      const by = finite(m.y) ? m.y : baseHeight(m.x, m.z, this.state.seed)
      if (dist3(player.x, player.y + 1.2, player.z, m.x, by, m.z) > 16 * 16) return
      const bad = digProblem(m.x, by, m.z, bomb.radius * 0.5, this.state.seed)
      if (bad === 'offMountain' || bad === 'air') {
        return this.toast(client, 'Bombs only work on the mountain!', 'warn')
      }
      player.backpack.splice(index, 1)
      this.broadcast('bomb', { x: m.x, y: by, z: m.z, id: bomb.id, fuse: BOMB_FUSE_MS })
      this.clock.setTimeout(() => {
        if (this.state.digs.length < MAX_DIGS) {
          // The blast ball never punches through bedrock.
          const cy = Math.max(by, MOUNTAIN.bedrock + bomb.radius * 0.35)
          this.state.digs.push(new Dig({ x: m.x, y: cy, z: m.z, r: bomb.radius, by: bomber }))
        }
        const owner = this.state.players.get(client.sessionId)
        const [lo, hi] = bomb.finds
        const n = lo + Math.floor(rand() * (hi - lo + 1))
        for (let i = 0; i < n; i += 1) {
          const a = (i / n) * Math.PI * 2 + rand()
          const r = bomb.radius * (0.25 + rand() * 0.55)
          this.spawnCrystal({
            x: m.x + Math.cos(a) * r,
            y: Math.max(MOUNTAIN.bedrock + 0.3, by - bomb.radius * 0.3),
            z: m.z + Math.sin(a) * r,
            player: owner,
            sessionId: owner ? client.sessionId : '',
            luckMult: owner ? this.luckMultiplier(owner, Date.now()) : 1,
            mutation: this.rollMutation(bomb.mutation, bomb.mutateChance ?? 1),
            state: 1,
          })
        }
        this.broadcast('boom', { x: m.x, y: by, z: m.z, id: bomb.id, r: bomb.radius })
      }, BOMB_FUSE_MS)
      return
    }

    if (item.kind === 'radar') {
      const radar = RADAR_BY_ID[item.type]
      if (!radar) return
      if (radar.id === 'rarity') {
        player.backpack.splice(index, 1)
        player.boostUntil = now + 120 * 1000
        this.toast(client, 'Luck surge x3 for 2 minutes!', 'good')
        return
      }
      if (!isDiggable(player.x, player.z, this.state.seed)) {
        return this.toast(client, 'Use radars on the mountain!', 'warn')
      }
      player.backpack.splice(index, 1)
      const points = []
      const count = radar.id === 'crystal' ? 3 : 2
      const weathers = WEATHERS.map((w) => w.mutation)
      for (let i = 0; i < count; i += 1) {
        const p = this.findDiggableNear(player.x, player.z, 5, 16)
        if (!p) continue
        const crystal = this.spawnCrystal({
          x: p.x,
          y: baseHeight(p.x, p.z, this.state.seed) - 0.35,
          z: p.z,
          player,
          sessionId: client.sessionId,
          minRarity: 1,
          anyDepth: true,
          weightMult: radar.id === 'crystal' ? 1.5 : 1,
          luckMult: this.luckMultiplier(player, now),
          mutation: radar.id === 'boulder' ? weathers[Math.floor(rand() * weathers.length)] : this.rollMutation(),
        })
        if (crystal) points.push({ x: p.x, z: p.z })
      }
      client.send('radar', { points })
    }
  }

  onPlace(client, m) {
    const player = this.playerOf(client)
    if (!player || !m || !finite(m.x) || !finite(m.z)) return
    const index = player.backpack.findIndex((it) => it.uid === m.uid && it.kind === 'crystal')
    if (index < 0) return
    if (player.garden.length >= player.gardenSlots) {
      return this.toast(client, 'Garden full! Buy more slots at your plot sign')
    }
    if (!plotContains(player.plot, m.x, m.z)) return this.toast(client, 'Place crystals inside YOUR plot')
    const src = player.backpack[index]
    const placed = new Item({
      uid: src.uid, kind: src.kind, type: src.type, size: src.size, weight: src.weight,
      mutation: src.mutation, value: src.value, luck: src.luck,
      x: m.x, z: m.z, rot: finite(m.rot) ? m.rot : 0,
    })
    player.backpack.splice(index, 1)
    player.garden.push(placed)
    this.recomputeLuck(player)
  }

  onTakeOut(client, m) {
    const player = this.playerOf(client)
    if (!player) return
    const index = player.garden.findIndex((it) => it.uid === m?.uid)
    if (index < 0) return
    const src = player.garden[index]
    if (this.carried(player) + src.weight > player.backpackCap + 1e-6) {
      return this.toast(client, 'Backpack full! Make room first')
    }
    const item = new Item({
      uid: src.uid, kind: src.kind, type: src.type, size: src.size, weight: src.weight,
      mutation: src.mutation, value: src.value, luck: src.luck,
    })
    player.garden.splice(index, 1)
    player.backpack.push(item)
    this.recomputeLuck(player)
  }

  onSortGarden(client) {
    const player = this.playerOf(client)
    if (!player) return
    const plot = PLOTS[player.plot]
    const items = [...player.garden].sort((a, b) => b.value - a.value)
    const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)))
    const usable = PLOT_SIZE - 3
    const step = usable / cols
    items.forEach((it, i) => {
      const cx = i % cols
      const cz = Math.floor(i / cols)
      it.x = plot.x - usable / 2 + step * (cx + 0.5)
      it.z = plot.z - usable / 2 + step * (cz + 0.5)
      it.rot = 0
    })
  }

  onDeposit(client, m) {
    const player = this.playerOf(client)
    if (!player) return
    const amount = Math.max(0, Math.min(player.candy, Math.floor(Number(m?.amount) || player.candy)))
    if (!amount) return this.toast(client, 'You have no candy corn to deposit')
    player.candy -= amount
    this.state.cauldron += amount
    if (this.state.cauldron >= this.state.cauldronGoal) {
      this.state.cauldron = 0
      this.startWeather(BLOODMOON.id, 5 * 60)
      this.state.nextWeatherAt = Math.max(this.state.nextWeatherAt, this.state.weatherEndsAt + 60000)
    }
  }

  onClaimQuest(client, m) {
    const player = this.playerOf(client)
    const quest = QUESTS[m?.index]
    if (!player || !quest) return
    let levels
    try {
      levels = JSON.parse(player.quests)
    } catch {
      levels = [0, 0, 0]
    }
    const level = levels[m.index] ?? 0
    if ((player[quest.stat] ?? 0) < questTarget(quest, level)) return this.toast(client, 'Quest not complete yet')
    const reward = questReward(quest, level)
    player.cash += reward.cash
    player.candy += reward.candy
    levels[m.index] = level + 1
    player.quests = JSON.stringify(levels)
  }

  onClaimPass(client) {
    const player = this.playerOf(client)
    if (!player) return
    const tier = PASS_TIERS[player.passClaimed]
    if (!tier) return
    if (player.crystalsMined < tier.need) return this.toast(client, `Mine ${tier.need} crystals to unlock this tier`)
    player.cash += tier.reward.cash ?? 0
    player.candy += tier.reward.candy ?? 0
    player.passClaimed += 1
  }
}

// Exported for tests/tools: mutation table sanity check at boot.
for (const w of WEATHERS) if (!MUTATIONS[w.mutation]) throw new Error(`Unknown mutation ${w.mutation}`)
