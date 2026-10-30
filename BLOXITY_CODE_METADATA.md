---
gameId: mine-antarctica
clientDir: client
buildCommand: npm run build
distDir: client/dist
# Freezing on the mountain is a death: Boxity's death screen, and a Respawn button
# (back to base) once its countdown is over.
canDie: true
# One leaderboard, declared by the client and scored by the server.
hasScore: true
leaderboards:
  - { id: crystals, label: Most crystals mined, mode: best, format: compact, reset: none }
roomSize: 8
notApplicable:
  rewardedAds: The game has no reward a player could earn by watching an ad.
  gems: Nothing is sold for Gems - every price is in cash, earned by mining.
  playWithFriends: Hosted on Boxity and joining through its matchmaker, so Boxity's own private rooms seat invited friends together; the game makes no private rooms of its own for CrazyGames' instant join.
---

# Mine Antarctica on Boxity

Where each piece of the Boxity integration lives:

| Feature | Where |
| --- | --- |
| Environment (prod / stage / local), every Boxity URL | `client/src/bloxity/env.js`, `server/src/boxity.js` |
| Sign-in, avatar and proportions (the one `onUserChanged`) | `client/src/bloxity/BloxityProvider.jsx` |
| Emotes, leaderboards, settings, ad breaks, player events, chat, Escape menu, screen ads | `client/src/bloxity/platform.js` |
| Death screen (freezing) | `client/src/bloxity/deathScreen.js`, `client/src/ui/DeathCard.jsx` |
| Emote playback | `client/src/game/emotes.js`, `client/src/game/avatar/avatarRig.js` |
| Chat bubbles | `client/src/game/speechBubbles.js`, `client/src/game/ChatBubbles.jsx` |
| Matchmaker, ?roomId= joins, rejoining after signing in, room and friend reporting | `client/src/net/net.js` |
| Token check, guest progress, room directory, leaderboard scores | `server/src/boxity.js`, `server/src/MineRoom.js`, `server/src/profiles.js` |
| Deploy to prod and stage | `.github/workflows/deploy.yml` |
