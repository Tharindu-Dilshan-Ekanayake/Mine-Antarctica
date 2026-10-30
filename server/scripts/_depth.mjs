import { Client } from '@colyseus/sdk'
import { baseHeight, MOUNTAIN } from '../../shared/world.js'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const room = await new Client('ws://localhost:2568').joinOrCreate('mine', { key: 'g:veteran1', name: 'Vet' })
await sleep(600)
const seed = room.state.seed
const X = 20
const Z = -100
const surf = baseHeight(X, Z, seed)
const NAMES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan']
console.log(`surface here: ${surf.toFixed(0)} m, crystalsMined ${room.state.players.get(room.sessionId).crystalsMined}`)
for (const depth of [1, 6, 12, 20, 28, 36]) {
  const y = Math.max(MOUNTAIN.bedrock + 1, surf - depth)
  const before = new Set()
  room.state.crystals.forEach((_c, id) => before.add(id))
  for (let tries = 0; tries < 220; tries += 1) {
    room.send('move', { x: X, y: y + 1, z: Z, ry: 0, anim: 0 })
    room.send('dig', { x: X + ((tries * 0.37) % 4), y, z: Z - 1.5, dx: 0, dy: 0, dz: -1 })
    await sleep(110)
  }
  const sizes = []
  room.state.crystals.forEach((c, id) => { if (!before.has(id)) sizes.push(c.size) })
  const count = (i) => sizes.filter((s) => s === i).length
  console.log(`depth ${String(depth).padStart(2)} m: ${NAMES.map((n, i) => `${n} ${count(i)}`).join(', ')}  (${sizes.length})`)
}
process.exit(0)
