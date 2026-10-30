import { pickWeighted } from './rng.js'

/**
 * Every tunable game number lives here, shared by the server (authoritative) and the
 * client (display only). Changing a price or a drop rate is a one-file edit.
 */

export const RARITIES = [
  { name: 'Common', color: '#d7d7d7', perKg: 24, luck: 0.08, hp: 40 },
  { name: 'Uncommon', color: '#4ee44e', perKg: 120, luck: 0.15, hp: 90 },
  { name: 'Rare', color: '#3d9bff', perKg: 640, luck: 0.21, hp: 200 },
  { name: 'Epic', color: '#b45cff', perKg: 3200, luck: 0.6, hp: 460 },
  { name: 'Legendary', color: '#ffb020', perKg: 16000, luck: 2.2, hp: 1050 },
  { name: 'Mythic', color: '#ff3d8b', perKg: 90000, luck: 6, hp: 2400 },
]

/**
 * Size bands. `w` is the weight range in kg; `p` the base probability; `hp` the HP
 * multiplier. Weight drives both sale value and the visual scale.
 */
export const SIZES = [
  { name: 'Tiny', w: [1, 2], p: 50, hp: 1 },
  { name: 'Small', w: [2, 6], p: 28, hp: 1.6 },
  { name: 'Medium', w: [6, 20], p: 14, hp: 2.6 },
  { name: 'Large', w: [20, 80], p: 6, hp: 4 },
  { name: 'Huge', w: [80, 400], p: 1.8, hp: 6 },
  { name: 'Gargantuan', w: [400, 4000], p: 0.2, hp: 9 },
]

/**
 * Crystal types. `shape` picks one of the procedural meshes on the client.
 * `color` is the body colour; mutations tint it further.
 */
export const CRYSTALS = [
  // Common
  { id: 'citrine', name: 'Citrine Shard Cluster', rarity: 0, shape: 'cluster', color: '#ffd23a' },
  { id: 'lavender', name: 'Lavender Crystal Cluster', rarity: 0, shape: 'cluster', color: '#c9a7ff' },
  { id: 'peridot', name: 'Peridot Column Stack', rarity: 0, shape: 'column', color: '#8cf03c' },
  { id: 'obelisk', name: 'Orange Obelisk', rarity: 0, shape: 'obelisk', color: '#ff8a1e' },
  { id: 'ladybug', name: 'Crystal Ladybug', rarity: 0, shape: 'beetle', color: '#ff2d3a' },
  { id: 'ducky', name: 'Crystal Ducky', rarity: 0, shape: 'duck', color: '#ffe23d' },
  // Uncommon
  { id: 'azure', name: 'Azure Ice Cluster', rarity: 1, shape: 'cluster', color: '#7fe6ff' },
  { id: 'bumblebee', name: 'Crystal Bumblebee', rarity: 1, shape: 'beetle', color: '#ffc21a' },
  { id: 'meerkat', name: 'Crystal Meerkat', rarity: 1, shape: 'critter', color: '#e8a860' },
  { id: 'rosegeode', name: 'Rose Quartz Geode', rarity: 1, shape: 'geode', color: '#ff9ccf' },
  { id: 'jade', name: 'Jade Spire', rarity: 1, shape: 'column', color: '#2fd18a' },
  // Rare
  { id: 'frostfern', name: 'Frost Fern Crystal', rarity: 2, shape: 'shard', color: '#bfefff' },
  { id: 'parrot', name: 'Crystal Pirate Parrot', rarity: 2, shape: 'bird', color: '#ff3b2f' },
  { id: 'sapphire', name: 'Sapphire Heart', rarity: 2, shape: 'geode', color: '#2f6bff' },
  { id: 'amethyst', name: 'Amethyst Crown', rarity: 2, shape: 'cluster', color: '#9b4dff' },
  // Epic
  { id: 'prism', name: 'Aurora Prism', rarity: 3, shape: 'obelisk', color: '#38ffd7' },
  { id: 'fox', name: 'Crystal Fox', rarity: 3, shape: 'critter', color: '#ff6a1a' },
  { id: 'fang', name: 'Obsidian Fang', rarity: 3, shape: 'shard', color: '#5b2a8a' },
  { id: 'penguin', name: 'Glacier Penguin', rarity: 3, shape: 'bird', color: '#3a4f7a' },
  // Legendary
  { id: 'axolotl', name: 'Crystal Axolotl', rarity: 4, shape: 'critter', color: '#ff7ad9' },
  { id: 'sunfire', name: 'Sunfire Core', rarity: 4, shape: 'geode', color: '#ffae00' },
  { id: 'dragonegg', name: 'Crystal Dragon Egg', rarity: 4, shape: 'egg', color: '#ff3d6e' },
  // Mythic
  { id: 'voidstar', name: 'Void Star', rarity: 5, shape: 'star', color: '#7a2cff' },
  { id: 'whale', name: 'Celestial Whale', rarity: 5, shape: 'critter', color: '#1d5cff' },
]

export const CRYSTAL_BY_ID = Object.fromEntries(CRYSTALS.map((c) => [c.id, c]))

export const SHAPES = [
  'cluster',
  'column',
  'obelisk',
  'shard',
  'geode',
  'beetle',
  'duck',
  'bird',
  'critter',
  'egg',
  'star',
]

/** Mutations: value multiplier and the colour they tint a crystal towards. */
export const MUTATIONS = {
  Drenched: { mult: 2, color: '#4aa3ff' },
  Poisoned: { mult: 3, color: '#5cff3a' },
  Frozen: { mult: 4, color: '#dff6ff' },
  Thundered: { mult: 5, color: '#3df0ff' },
  Lucky: { mult: 5, color: '#3cff6e' },
  Starstruck: { mult: 6, color: '#ffe14a' },
  Molten: { mult: 7, color: '#ff5a14' },
  Aurora: { mult: 8, color: '#7dffcf' },
  Blood: { mult: 10, color: '#b3001b' },
}

/** Weather that brews mutations on freshly found crystals. Percentages are per cycle. */
export const WEATHERS = [
  { id: 'rain', name: 'Rain', rarity: 'Common', chance: 14, mutation: 'Drenched' },
  { id: 'acid', name: 'Acid Rain', rarity: 'Uncommon', chance: 12.5, mutation: 'Poisoned' },
  { id: 'blizzard', name: 'Blizzard', rarity: 'Rare', chance: 13, mutation: 'Frozen' },
  { id: 'thunder', name: 'Thunder', rarity: 'Epic', chance: 12, mutation: 'Thundered' },
  { id: 'lucky', name: 'Lucky', rarity: 'Epic', chance: 11, mutation: 'Lucky' },
  { id: 'starfall', name: 'Starfall', rarity: 'Legendary', chance: 11.5, mutation: 'Starstruck' },
  { id: 'heatwave', name: 'Heatwave', rarity: 'Legendary', chance: 8, mutation: 'Molten' },
  { id: 'aurora', name: 'Aurora', rarity: 'Mythic', chance: 6, mutation: 'Aurora' },
]
/** The event weather, only triggered by filling the candy cauldron. */
export const BLOODMOON = { id: 'bloodmoon', name: 'Bloodmoon', rarity: 'Event', chance: 0, mutation: 'Blood' }
export const WEATHER_BY_ID = Object.fromEntries(
  [...WEATHERS, BLOODMOON].map((w) => [w.id, w]),
)

export const WEATHER_TIMING = {
  /** Seconds between the starts of two weather windows. */
  cycle: 6 * 60,
  /** How long a weather lasts. */
  duration: 150,
  /** Chance a found crystal picks up the active weather's mutation. */
  mutateChance: 0.4,
}

/** Rarity weights per altitude zone (see ZONES in world.js). */
export const ZONE_WEIGHTS = [
  [70, 24, 5, 0.9, 0.1, 0],
  [40, 40, 15, 4, 0.9, 0.1],
  [20, 35, 30, 12, 2.5, 0.5],
  [8, 22, 35, 27, 6.5, 1.5],
  [3, 12, 30, 35, 16, 4],
  [1, 6, 22, 36, 25, 10],
]

export const PICKAXES = [
  { id: 'rusted', name: 'Rusted Scrapper', rarity: 0, power: 25, mineSize: 10, price: 0, candy: 0, head: '#c0622b', handle: '#8a8f96' },
  { id: 'timber', name: 'Splintered Timber', rarity: 0, power: 45, mineSize: 18, price: 25, candy: 25, head: '#9aa3ab', handle: '#e2d6bd' },
  { id: 'flint', name: 'Chipped Flint', rarity: 1, power: 75, mineSize: 32, price: 110, candy: 39, head: '#5d6670', handle: '#6b4a2e' },
  { id: 'slate', name: 'Slate Breaker', rarity: 1, power: 120, mineSize: 44, price: 650, candy: 70, head: '#3d4a5c', handle: '#7a5230' },
  { id: 'copper', name: 'Copper Cleaver', rarity: 2, power: 190, mineSize: 56, price: 2800, candy: 120, head: '#d97b3a', handle: '#4a3020' },
  { id: 'iron', name: 'Iron Fang', rarity: 2, power: 300, mineSize: 70, price: 14000, candy: 200, head: '#c9cfd6', handle: '#2b2b33' },
  { id: 'frostbite', name: 'Frostbite Pick', rarity: 3, power: 480, mineSize: 86, price: 70000, candy: 340, head: '#8fe8ff', handle: '#2a4a7a' },
  { id: 'glacier', name: 'Glacier Splitter', rarity: 3, power: 760, mineSize: 104, price: 350000, candy: 560, head: '#4fd2ff', handle: '#f0f8ff' },
  { id: 'aurora', name: 'Aurora Reaver', rarity: 4, power: 1200, mineSize: 124, price: 1800000, candy: 900, head: '#4dffc3', handle: '#7a2cff' },
  { id: 'celestial', name: 'Celestial Shatter', rarity: 5, power: 2000, mineSize: 150, price: 9500000, candy: 1500, head: '#ff5ad1', handle: '#ffd84a' },
]
export const PICKAXE_BY_ID = Object.fromEntries(PICKAXES.map((p) => [p.id, p]))

/** Swing cooldown in seconds. */
export const SWING_TIME = 0.42

export const BOMBS = [
  { id: 'classic', name: 'Classic Bomb', rarity: 0, price: 50000, stock: 3, radius: 5, finds: [3, 5], mutation: null,
    desc: 'Blasts a crater and pops out a spread of crystals.', color: '#2a2d3a' },
  { id: 'snowflake', name: 'Snowflake Bomb', rarity: 0, price: 400000, stock: 2, radius: 5.5, finds: [3, 5], mutation: 'Frozen', mutateChance: 0.5,
    desc: 'Bursts into a snowstorm - freezes the crater with snow and ice and scatters frost crystals.', color: '#cfefff' },
  { id: 'ice', name: 'Ice Bomb', rarity: 1, price: 2000000, stock: 2, radius: 6, finds: [4, 6], mutation: 'Frozen', mutateChance: 1,
    desc: 'Freezes the blast zone into glacier and drops guaranteed Frost crystals.', color: '#8fe0ff' },
  { id: 'fire', name: 'Fire Bomb', rarity: 2, price: 9000000, stock: 1, radius: 6.5, finds: [4, 7], mutation: 'Molten', mutateChance: 1,
    desc: 'Sets the crater molten and scatters guaranteed Molten crystals.', color: '#ff6a1a' },
]

export const RADARS = [
  { id: 'crystal', name: 'Crystal Radar', rarity: 0, price: 300000, stock: 10,
    desc: 'FINDS veins: 3 buried crystals (Uncommon+, 1.5x weight) close to you.', color: '#f5d9ff' },
  { id: 'rarity', name: 'Rarity Radar', rarity: 1, price: 1500000, stock: 4,
    desc: 'Surges your luck x3 for 2 minutes and names every rarity near you.', color: '#d8dde6' },
  { id: 'boulder', name: 'Boulder Radar', rarity: 2, price: 6000000, stock: 2,
    desc: 'Finds 2 buried crystals with a GUARANTEED weather mutation.', color: '#c9a36a' },
]

export const BOMB_BY_ID = Object.fromEntries(BOMBS.map((b) => [b.id, b]))
export const RADAR_BY_ID = Object.fromEntries(RADARS.map((r) => [r.id, r]))

/** Seconds between shop restocks. */
export const RESTOCK_SECONDS = 15 * 60
/** Seconds between mountain rerolls ("Mountain RNG"). */
export const REROLL_SECONDS = 60 * 60

export const START = {
  cash: 0,
  warmth: 12,
  backpack: 22,
  gardenSlots: 5,
}

/** Metres of altitude one point of warmth keeps safe. */
export const WARMTH_TO_METRES = 2.5
export const safeAltitude = (warmth) => warmth * WARMTH_TO_METRES

/** Price of the next single unit of warmth when you have `w`. */
const warmthUnit = (w) => 5 + w * 2.2
/** Price of the next single kg of capacity when you have `kg`. */
const backpackUnit = (kg) => 10 + kg * 13

function seriesCost(unit, from, count) {
  let total = 0
  for (let i = 0; i < count; i += 1) total += unit(from + i)
  return Math.round(total)
}

/** Largest count affordable with `cash`, starting at `from`. Capped for sanity. */
function maxAffordable(unit, from, cash, cap = 200000) {
  let total = 0
  let n = 0
  while (n < cap) {
    const next = unit(from + n)
    if (total + next > cash) break
    total += next
    n += 1
  }
  return { count: n, cost: Math.round(total) }
}

export const upgradeCost = {
  warmth: (from, count) => seriesCost(warmthUnit, from, count),
  backpack: (from, count) => seriesCost(backpackUnit, from, count),
  warmthMax: (from, cash) => maxAffordable(warmthUnit, from, cash),
  backpackMax: (from, cash) => maxAffordable(backpackUnit, from, cash),
}

/** Price of the next garden slot. */
export const gardenSlotCost = (slots) => Math.round(300 * Math.pow(1.35, slots - 5))
export const MAX_GARDEN_SLOTS = 40

export function crystalValue(typeId, weight, mutation) {
  const type = CRYSTAL_BY_ID[typeId]
  if (!type) return 0
  const mult = mutation ? MUTATIONS[mutation]?.mult ?? 1 : 1
  return Math.round(RARITIES[type.rarity].perKg * weight * mult)
}

/** Garden luck bonus in percent for one placed crystal. */
export function crystalLuck(typeId, weight, mutation) {
  const type = CRYSTAL_BY_ID[typeId]
  if (!type) return 0
  const mut = mutation ? 1.5 : 1
  return Math.round(RARITIES[type.rarity].luck * Math.sqrt(weight) * mut * 10) / 10
}

export function crystalHp(typeId, sizeIndex) {
  const type = CRYSTAL_BY_ID[typeId]
  return Math.round(RARITIES[type?.rarity ?? 0].hp * SIZES[sizeIndex].hp)
}

/** Visual scale (m) for a crystal of this weight. */
export const crystalScale = (weight) => Math.min(9, 0.42 * Math.cbrt(weight))

/**
 * Rolls a crystal type for a zone. `luck` is a multiplier >= 1; it pushes weight
 * onto rarer tiers exponentially, which is what makes big garden luck matter.
 * `minRarity` forces at least that tier (radars).
 */
export function rollCrystal(rand, zone, luck = 1, minRarity = 0) {
  const base = ZONE_WEIGHTS[Math.max(0, Math.min(ZONE_WEIGHTS.length - 1, zone))]
  const weights = base.map((w, r) => (r < minRarity ? 0 : w * Math.pow(luck, r * 0.6)))
  if (weights.every((w) => w === 0)) weights[weights.length - 1] = 1
  const rarity = pickWeighted(weights, rand())
  const pool = CRYSTALS.filter((c) => c.rarity === rarity)
  const type = pool[Math.floor(rand() * pool.length)]

  const sizeWeights = SIZES.map((s, i) => s.p * Math.pow(Math.min(luck, 50), i * 0.25))
  const sizeIndex = pickWeighted(sizeWeights, rand())
  const [lo, hi] = SIZES[sizeIndex].w
  // Bias toward the low end of the band, so big ones stay special.
  const weight = Math.round((lo + (hi - lo) * Math.pow(rand(), 2.2)) * 10) / 10
  return { typeId: type.id, sizeIndex, weight }
}

/** Repeatable quest chains. Target and reward scale with the level reached. */
export const QUESTS = [
  { id: 'mine', label: 'Mine {n} crystals', stat: 'crystalsMined', base: 10, reward: { cash: 400 } },
  { id: 'sell', label: 'Sell ${n} worth of crystals', stat: 'totalSold', base: 2000, reward: { candy: 20 } },
  { id: 'climb', label: 'Reach {n}m altitude', stat: 'bestAlt', base: 40, reward: { cash: 1500 }, growth: 1.6 },
]
export function questTarget(quest, level) {
  return Math.round(quest.base * Math.pow(quest.growth ?? 2.5, level))
}
export function questReward(quest, level) {
  const scale = Math.pow(2.2, level)
  return {
    cash: Math.round((quest.reward.cash ?? 0) * scale),
    candy: Math.round((quest.reward.candy ?? 0) * scale),
  }
}

/** Frost Pass tiers: crystals mined needed and the reward for each. */
export const PASS_TIERS = Array.from({ length: 15 }, (_, i) => ({
  need: Math.round(5 * Math.pow(i + 1, 1.6)),
  reward: i % 2 === 0 ? { cash: Math.round(500 * Math.pow(2.1, i)) } : { candy: 15 * (i + 1) },
}))

/** Community candy goal per room; filling it summons the Bloodmoon. */
export const CAULDRON_GOAL = 400

/**
 * Level upgrades bought with cash at UPGRADES: each level costs more than the last.
 *   swing - Mine Faster: shorter time between pickaxe swings
 *   speed - Run Faster: quicker on your feet, so trips to sell are shorter
 */
export const LEVEL_UPGRADES = {
  swing: { max: 25, base: 350, growth: 1.34 },
  speed: { max: 20, base: 250, growth: 1.32 },
}
export const levelCost = (kind, level) => Math.round(LEVEL_UPGRADES[kind].base * Math.pow(LEVEL_UPGRADES[kind].growth, level))

/** Cost of `count` levels from `level`, and how many `cash` affords (capped at max). */
export function levelSeries(kind, level, cash, count = Infinity) {
  const { max } = LEVEL_UPGRADES[kind]
  let total = 0
  let n = 0
  while (n < count && level + n < max) {
    const next = levelCost(kind, level + n)
    if (count === Infinity && total + next > cash) break
    total += next
    n += 1
  }
  return { count: n, cost: total }
}

/** Seconds per swing at Mine Faster level `level` (down to half the base time). */
export const swingTime = (level = 0) => SWING_TIME / (1 + Math.min(level, 25) * 0.04)
/** Walk speed multiplier at Run Faster level `level` (up to 1.6x). */
export const moveMultiplier = (level = 0) => 1 + Math.min(level, 20) * 0.03
