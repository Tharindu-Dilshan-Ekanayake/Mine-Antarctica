/**
 * Load-test / smoke-test bots.
 *
 *   node scripts/bots.js [count=5] [url=ws://localhost:2567] [seconds=0]
 *
 * Each bot joins the 'mine' room, walks a circle on the lower mountain and swings
 * its pickaxe, picking up anything it frees. With count > 6 you can watch matchmaking
 * open a second room. seconds=0 runs until Ctrl+C.
 */
import { Client } from '@colyseus/sdk'

import { baseHeight, isDiggable, MOUNTAIN } from '../../shared/world.js'

const count = Number(process.argv[2] ?? 5)
const url = process.argv[3] ?? 'ws://localhost:2567'
const seconds = Number(process.argv[4] ?? 0)

const client = new Client(url)
const rooms = []

async function runBot(i) {
  const room = await client.joinOrCreate('mine', { key: `bot-${i}`, name: `Bot${i + 1}` })
  rooms.push(room)
  let digs = 0
  let finds = 0
  room.onMessage('found', () => (finds += 1))
  room.onMessage('*', () => {})

  // Walk a ring on the mountain's lower slopes, each bot at its own angle.
  const ring = MOUNTAIN.radius * 0.72
  let angle = Math.PI / 2 + (i - count / 2) * 0.08
  const timer = setInterval(() => {
    angle += 0.004
    const x = MOUNTAIN.cx + Math.cos(angle) * ring
    const z = MOUNTAIN.cz + Math.sin(angle) * ring
    const y = baseHeight(x, z, room.state.seed)
    room.send('move', { x, y, z, ry: angle, anim: 1 })
    if (isDiggable(x, z, room.state.seed)) {
      // Alternate digging down at the feet and sideways into the slope.
      const side = digs % 2 === 1
      const dx = side ? Math.cos(angle + Math.PI) : 0
      const dz = side ? Math.sin(angle + Math.PI) : 0
      room.send('dig', { x: x + dx * 1.2, y: y + (side ? 0.6 : -0.3), z: z + dz * 1.2, dx, dy: side ? 0 : -1, dz })
      digs += 1
    }
    for (const [id, c] of room.state.crystals) {
      if (c.owner !== room.sessionId) continue
      if (c.state === 0) room.send('hit', { id })
      else room.send('pickup', { id })
    }
  }, 450)

  room.onLeave(() => clearInterval(timer))
  return { room, stats: () => ({ digs, finds }) }
}

const bots = []
for (let i = 0; i < count; i += 1) {
  bots.push(await runBot(i))
}

const byRoom = new Map()
for (const b of bots) byRoom.set(b.room.roomId, (byRoom.get(b.room.roomId) ?? 0) + 1)
console.log(`${count} bots connected across ${byRoom.size} room(s):`, Object.fromEntries(byRoom))

const report = setInterval(() => {
  const r = bots[0].room
  const me = r.state.players.get(r.sessionId)
  console.log(
    `players=${r.state.players.size} digs=${r.state.digs.length} crystals=${r.state.crystals.size}` +
      ` bot1 backpack=${me?.backpack.length} mined=${me?.crystalsMined}`,
  )
}, 5000)

if (seconds > 0) {
  setTimeout(async () => {
    clearInterval(report)
    for (const r of rooms) await r.leave()
    process.exit(0)
  }, seconds * 1000)
}
