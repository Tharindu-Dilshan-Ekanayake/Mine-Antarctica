import cors from 'cors'
import express from 'express'
import { Server, WebSocketTransport } from 'colyseus'

import { flushScores, hostedOrigins, installRoomReporter, installScoreReporter, verifyPlayerToken } from './boxity.js'
import { isKeyActive, liveRooms, MineRoom } from './MineRoom.js'
import { flushProfiles, openStorage, setActivePredicate } from './profiles.js'

// Boxity hosting injects PORT (HTTP and WebSocket share it); 2567 is Colyseus's usual.
const PORT = Number(process.env.PORT) || 2567

/**
 * Browser origins allowed to call /api: the game's Boxity-hosted pages in the
 * environment we were told, extra ones from ALLOWED_ORIGINS, and Vite dev servers.
 */
const ALLOWED_ORIGINS = [
  // Boxity injects the game site's origin on every deploy.
  process.env.CLIENT_ORIGIN,
  ...hostedOrigins(),
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()),
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
].filter(Boolean)

const gameServer = new Server({
  transport: new WebSocketTransport({ pingInterval: 5000 }),
  greet: false,
  express: (app) => {
    // Boxity's readiness and liveness probes: answered at once, whatever else is going on.
    app.get('/health', (_req, res) => {
      res.json({ ok: true })
    })

    app.use('/api', cors({ origin: ALLOWED_ORIGINS, credentials: true }))
    app.use('/api', express.json())

    app.get('/api/health', (_req, res) => {
      res.json({ ok: true, game: 'mine-antarctica' })
    })

    /**
     * For `Legion.SDK.auth.authenticateWithServer('/api/legion-auth')`: the frontend POSTs
     * `{ token, user }`, and only what Boxity says about the token counts - never the
     * `user` it sent along.
     */
    app.post('/api/legion-auth', async (req, res) => {
      const verified = await verifyPlayerToken(req.body?.token)
      if (!verified) return res.status(401).json({ error: 'invalid token' })
      res.json({ user: { legionId: String(verified.user._id), username: verified.user.username } })
    })

    /**
     * Boxity's Gems webhook. Nothing in Mine Antarctica is sold for Gems (every price is
     * in-game cash), so there is nothing to grant: answer 2xx so Boxity never retries.
     */
    app.post('/api/legion-webhook', (_req, res) => {
      res.sendStatus(200)
    })
  },
})

// One room type. Matchmaking fills a room up to MAX_PLAYERS (8), then opens a new one.
gameServer.define('mine', MineRoom)

// SIGTERM (a deploy or scale-in): every room saves, then the scores and profiles go out.
gameServer.onShutdown(async () => {
  for (const room of liveRooms) {
    room.saveAll()
    room.collectScores()
  }
  await flushScores()
  await flushProfiles()
})

// Saves: Boxity's managed MongoDB when MONGODB_URI is set, else a local file. Opened
// before the first player can connect.
setActivePredicate(isKeyActive)
await openStorage()
await gameServer.listen(PORT)
// Boxity: this pod's rooms for "Open Rooms" and join-by-id, and the leaderboard scores.
// Both do nothing outside a Boxity deployment.
installRoomReporter()
installScoreReporter(() => {
  for (const room of liveRooms) room.collectScores()
})
console.log(`Mine Antarctica server listening on port ${PORT}${process.env.POD_NAME ? ` (${process.env.POD_NAME})` : ''}`)
