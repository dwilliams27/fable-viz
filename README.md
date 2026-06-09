# NECTARWORLD

**A live Redis instance, rendered as an explorable alien world.**

A real `redis-server` runs locally, fed by a simulated social app ("Nectar": sessions,
profile caches, leaderboards, job queues, tag sets, rate limiters, pub/sub chat). Every
single thing you see in the 3D world is a real event from that Redis — tapped via
`MONITOR`, keyspace notifications, and `INFO`, streamed over WebSocket into a Three.js
first-person world.

## Run it

```sh
npm install        # once (redis-server must be on PATH — `brew install redis`)
npm start          # boots redis (port 6390) + bridge (ws 7080) + vite (5173), opens browser
```

Click to descend. **WASD** walk · **Shift** sprint · **F** toggle fly · **Space/C** rise & sink.
Look at any organism to read its key, type, size, and TTL. `?demo=1` for an auto-orbiting camera.

## The dictionary — what is true

| You see | It is |
|---|---|
| **The Nucleus** (pulsing orb, spinning rings) | Redis's event loop. Every command beats it; ring spin speed = ops/sec |
| **Tendrils** from nucleus to each biome | Command flow into that subsystem — they light up as traffic flows |
| **Light streaks** | Individual commands: client → nucleus → key. Reads fly back from key to client |
| **The Client Shore** (anemones) | Connected clients (by addr from `MONITOR`); each flash = a command from that socket |
| **Cyan crystals** (Mayfly Fields / Crystal Grove) | String keys; height ~ value size. Sessions & page caches |
| **Amber honeycombs** (Honeycomb Terraces) | Hashes — one hex cell per field (`HSET` grows them) |
| **Magenta worms** (Worm Gardens) | Lists/job queues — one segment per queued job; `RPOP` shrinks them |
| **Green spore clusters** (Spore Glade) | Sets — one orbiting spore per member |
| **Violet helix spires** (Spiral Spires) | Sorted sets — one node per member; the leader glows at the top |
| **Pulse stones** (Pulse Steppe) | Counters — `INCR` ripples them |
| **Gold kelp towers** (Aurora Canopy) | Pub/sub channels; `PUBLISH` fires expanding aurora rings + delivery streaks to subscribers |
| **Dimming / flickering organisms** | TTL running out. When a key expires, its organism crumbles into embers |
| **The violet curtain wave + ghost caravan** | `BGSAVE`: the forked child sweeping the keyspace, copying every key to **the Vault** (obsidian obelisk = RDB file) |
| **The Memory Moon** | `used_memory` — it brightens and shifts hue as memory grows |

Architecture: `server/bridge.mjs` (MONITOR/notifications/INFO → WebSocket) ·
`server/workload.mjs` (the simulated app) · `src/` (Three.js world).
