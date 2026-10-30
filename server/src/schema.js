import { schema, t } from '@colyseus/schema'

/**
 * Synchronised room state.
 *
 * Positions are float32 and patched at the room's patchRate (20 Hz). Everything
 * economic (cash, items, upgrades) is written only by the server.
 */

/** A crystal in someone's backpack or garden. Also used for bombs/radars (kind). */
export const Item = schema(
  {
    uid: t.string(),
    /** 'crystal' | 'bomb' | 'radar' */
    kind: t.string().default('crystal'),
    /** Crystal type id, or bomb/radar id. */
    type: t.string(),
    size: t.uint8().default(0),
    weight: t.float32().default(0),
    mutation: t.string().default(''),
    value: t.float64().default(0),
    luck: t.float32().default(0),
    /** Garden placement; unused while in the backpack. */
    x: t.float32().default(0),
    z: t.float32().default(0),
    rot: t.float32().default(0),
  },
  'Item',
)

export const Player = schema(
  {
    name: t.string().default('Guest'),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.float32().default(0),
    /** 0 idle, 1 walk, 2 air, 3 swing */
    anim: t.uint8().default(0),
    /** JSON: { equipped, proportions } from the Bloxity SDK, for remote avatars. */
    avatar: t.string().default(''),
    plot: t.uint8().default(0),
    /** The player's verified Boxity account id ('' for a guest): whose chat bubble is whose. */
    uid: t.string().default(''),
    /** Boxity emote playing (catalogue id, '' for none) and when it started (server ms). */
    emote: t.string().default(''),
    emoteAt: t.float64().default(0),

    cash: t.float64().default(0),
    candy: t.uint32().default(0),
    warmth: t.uint32().default(12),
    backpackCap: t.float32().default(22),
    pickaxe: t.string().default('rusted'),
    owned: t.array('string'),
    backpack: t.array(Item),
    garden: t.array(Item),
    gardenSlots: t.uint8().default(5),
    luck: t.float32().default(0),
    boostUntil: t.float64().default(0),
    discovered: t.array('string'),

    crystalsMined: t.uint32().default(0),
    totalSold: t.float64().default(0),
    bestAlt: t.float32().default(0),
    /** JSON array of quest levels, and number of Frost Pass tiers claimed. */
    quests: t.string().default('[0,0,0]'),
    passClaimed: t.uint8().default(0),
    /** Mine Faster / Run Faster upgrade levels. */
    swingLvl: t.uint8().default(0),
    speedLvl: t.uint8().default(0),
  },
  'Player',
)

/** A crystal out in the world: buried (being mined) or loose (ready to pick up). */
export const Crystal = schema(
  {
    type: t.string(),
    size: t.uint8().default(0),
    weight: t.float32().default(1),
    mutation: t.string().default(''),
    value: t.float64().default(0),
    luck: t.float32().default(0),
    x: t.float32(),
    /** Height of the crystal's centre: buried ones sit inside the tunnel wall. */
    y: t.float32().default(0),
    z: t.float32(),
    rot: t.float32().default(0),
    hp: t.float32().default(1),
    maxHp: t.float32().default(1),
    /** 0 buried, 1 loose */
    state: t.uint8().default(0),
    owner: t.string().default(''),
    ownerName: t.string().default(''),
  },
  'Crystal',
)

/**
 * One pickaxe swing (or bomb blast): a ball of ground removed from the mountain.
 * Balls go wherever the player aims, so digs make craters, shafts and tunnels.
 */
export const Dig = schema(
  {
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    r: t.float32(),
    /** Who dug it: a small id of the player's save (0 = unknown), for the far-away markers. */
    by: t.uint16().default(0),
  },
  'Dig',
)

export const BoardRow = schema(
  {
    name: t.string(),
    value: t.float64(),
  },
  'BoardRow',
)

export const MineState = schema(
  {
    players: t.map(Player),
    crystals: t.map(Crystal),
    digs: t.array(Dig),
    seed: t.uint32().default(1),
    rerollAt: t.float64().default(0),
    weather: t.string().default(''),
    weatherEndsAt: t.float64().default(0),
    nextWeatherAt: t.float64().default(0),
    stock: t.map('uint8'),
    restockAt: t.float64().default(0),
    cauldron: t.uint32().default(0),
    cauldronGoal: t.uint32().default(400),
    boardMined: t.array(BoardRow),
    boardCash: t.array(BoardRow),
  },
  'MineState',
)
