# Mine Antarctica (web)

A browser remake of the Roblox game *Mine Antarctica*: climb the mountain, dig for
crystals, sell them, upgrade your warmth / backpack / pickaxe, and grow a crystal
garden for more luck. Up to **8 players per server**, synced with **Colyseus**.

```
client/   React + React Three Fiber (Vite)    -> http://localhost:5173
server/   Colyseus 0.18 game server           -> ws://localhost:2567
shared/   game data + terrain maths used by BOTH (so the mountain is identical everywhere)
```

## Run it

```bash
# 1. game server
cd server
npm install
npm run dev          # ws://localhost:2567

# 2. client (second terminal)
cd client
npm install
npm run dev          # http://localhost:5173
```

Open the client in up to 6 tabs/devices to fill a server; the 7th player gets a new one.
Set `VITE_SERVER_URL` in `client/.env` if the server is not on the same host.

Simulated players (good for testing a full room):

```bash
cd server
npm run bots -- 7            # 7 bots + you = a full 8-player server
```

## How to play

| Desktop | Touch | |
|---|---|---|
| WASD / Space / Shift | joystick, JUMP | move, jump, sprint |
| Left click (hold) | ⛏ button | dig where you point (down, ahead, up) / mine a crystal |
| Right drag, wheel | drag, pinch | camera |
| E | PICK UP / OPEN | pick up a crystal, open a stall |
| 1-0 | tap slot | hotbar (select a crystal in your plot to place it) |
| Q / E | ROTATE | rotate while placing |
| H or BASE | BASE | go home |

Digging is fully 3D: every swing removes a ball of ground in the direction you aim
(the blue wire ball previews it), so you can dig shafts straight down, tunnel
sideways into the slope and walk through, or open up a ceiling. Bedrock stops you
at the bottom, and tunnels can go up to 40 m below the surface. On touch, you dig
where the camera looks.

Loop: dig on the mountain → break crystals free → pick them up (backpack has a kg
limit) → SELL at the base → buy pickaxes (power + mine size), warmth (climb higher
before you freeze), backpack capacity, bombs and radars. Higher **rarity zones**
drop rarer crystals; **weather** mutates finds (x2…x10 value); crystals placed in your
**garden plot** add digging luck. The **Mountain RNG** rerolls the whole mountain every
hour. Fill the **candy cauldron** together to summon the Bloodmoon.

## Server notes

- Authoritative economy: the server rolls every crystal, owns cash/items, validates
  reach and cooldowns. Movement is client-predicted and range-checked.
- Profiles persist in `server/data/profiles.json`, keyed by Bloxity user id (or a
  per-browser guest id). Swap `server/src/profiles.js` for a database before running
  more than one server process.
- `/api/legion-auth` still trusts the client: verify the Bloxity JWT there before
  relying on logins for anything valuable.

## How digging works (code map)

- `shared/world.js` - `digRadius` (ball size per pickaxe) and `digProblem` (rules
  shared by client and server).
- `client/src/game/terrain/digStore.js` - every dug ball, spatially hashed.
- `client/src/game/terrain/solid.js` - "is this point ground?", floor/ceiling per
  column and raycasts: used by walking, the camera spring arm and aiming.
- `client/src/game/mountain/volumeMesh.js` - marching-tetrahedra mesh of dug ground.
  Undug ground stays a cheap heightfield, which cuts holes where volumes take over.
- `client/src/game/mountain/volumes.js` - builds those meshes a few ms per frame,
  nearest first, within the preset's dig view radius.

## Performance

Built to the budgets in the project perf contract: quality presets LOW / MEDIUM / HIGH
(auto-detected, auto-dropped by `<PerformanceMonitor>` under 45 FPS), instanced crystals
(11 draw calls for every crystal in the world), merged static scenery, a 3x3 streamed
high-detail terrain window over a coarse mountain mesh, pooled particles, no physics
engine. Add `?perf` to the dev URL for the r3f-perf overlay.
