// sectors.js — the biome map. Every key prefix owns a wedge of the world.
import * as THREE from 'three';

const TAU = Math.PI * 2;

export const TYPE_COLORS = {
  string: 0x4de8ff,  // cyan crystal
  hash: 0xffb347,    // amber honeycomb
  list: 0xff4dd2,    // magenta worm
  set: 0x7dff6a,     // green spores
  zset: 0xb07aff,    // violet helix
  channel: 0xffe44d, // gold aurora kelp
  stone: 0x6fffe0,   // counter pulse-stones
};

export const SECTORS = [
  { id: 'sessions', match: /^session:/, label: 'Mayfly Fields', sub: 'SETEX sessions · born dying', angle: 0 },
  { id: 'cache', match: /^cache:/, label: 'Crystal Grove', sub: 'page cache · GET / SET EX', angle: TAU * 1 / 8 },
  { id: 'users', match: /^user:/, label: 'Honeycomb Terraces', sub: 'profile hashes · HSET', angle: TAU * 2 / 8 },
  { id: 'queues', match: /^queue:/, label: 'Worm Gardens', sub: 'job queues · LPUSH → RPOP', angle: TAU * 3 / 8 },
  { id: 'tags', match: /^(tags:|online$)/, label: 'Spore Glade', sub: 'sets · SADD / SREM', angle: TAU * 4 / 8 },
  { id: 'boards', match: /^leaderboard:/, label: 'Spiral Spires', sub: 'sorted sets · ZINCRBY', angle: TAU * 5 / 8 },
  { id: 'counters', match: /^(rate:|stats:)/, label: 'Pulse Steppe', sub: 'counters · INCR', angle: TAU * 6 / 8 },
  { id: 'chat', match: /^chat:/, label: 'Aurora Canopy', sub: 'pub/sub · PUBLISH', angle: TAU * 7 / 8 },
];

export const BAND = { inner: 52, outer: 112 };
export const VAULT = new THREE.Vector3(Math.cos(TAU * 4 / 8) * 170, 0, Math.sin(TAU * 4 / 8) * 170);
export const REEF = { angle: 0, radius: 150 }; // beyond the Mayfly Fields: the client shore
export const NUCLEUS_POS = new THREE.Vector3(0, 17, 0);

export function sectorFor(key) {
  for (const s of SECTORS) if (s.match.test(key)) return s;
  return SECTORS[6]; // strays graze the steppe
}

export function sectorCenter(s, radius = (BAND.inner + BAND.outer) / 2) {
  return new THREE.Vector3(Math.cos(s.angle) * radius, 0, Math.sin(s.angle) * radius);
}

// deterministic key -> spot inside its wedge (stable across reloads)
export function placeKey(key) {
  const s = sectorFor(key);
  let h1 = 2166136261, h2 = 0x9e3779b9;
  for (let i = 0; i < key.length; i++) {
    h1 = Math.imul(h1 ^ key.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 + key.charCodeAt(i), 0x85ebca6b) ^ (h2 >>> 13);
  }
  const u = ((h1 >>> 0) % 10000) / 10000, v = ((h2 >>> 0) % 10000) / 10000;
  const spread = (TAU / 8) * 0.38;
  const angle = s.angle + (u - 0.5) * 2 * spread;
  const radius = BAND.inner + Math.sqrt(v) * (BAND.outer - BAND.inner);
  return { sector: s, pos: new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius) };
}
