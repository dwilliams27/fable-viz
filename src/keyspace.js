// keyspace.js — every live Redis key is an organism. Type decides anatomy:
// string=crystal, hash=honeycomb, list=worm, set=spore cluster, zset=helix spire,
// counters=pulse stones, pub/sub channels=aurora kelp. TTL is visible mortality.

import * as THREE from 'three';
import { TYPE_COLORS, placeKey, sectorFor } from './sectors.js';
import { heightAt } from './world.js';

const MAX_KEYS = 650;

// shared geometry cache
const G = {
  oct: new THREE.OctahedronGeometry(1),
  hex: new THREE.CylinderGeometry(0.62, 0.78, 1, 6),
  ball: new THREE.SphereGeometry(1, 14, 10),
  icosa: new THREE.IcosahedronGeometry(1, 0),
  column: new THREE.CylinderGeometry(0.16, 0.22, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 7),
  disc: new THREE.SphereGeometry(1, 18, 12),
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hashOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return (h >>> 0) / 4294967296; };

function mat(color, mult = 1) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.userData.base = new THREE.Color(color).multiplyScalar(mult);
  m.color.copy(m.userData.base);
  return m;
}

// ---------- anatomy builders (return { group children added }, set entry.spin if part should rotate) ----------
function buildOrganism(entry) {
  const g = entry.group;
  // wipe previous body
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    c.material?.dispose?.();
    g.remove(c);
  }
  entry.mats = [];
  entry.spin = null;
  const seed = hashOf(entry.name);
  const add = (mesh) => {
    mesh.userData.keyName = entry.name;
    entry.mats.push(mesh.material);
    g.add(mesh);
    return mesh;
  };
  const size = Math.max(entry.size ?? 1, 0);

  switch (entry.kind) {
    case 'crystal': { // strings: elongated emissive shards
      const h = (entry.sector.id === 'sessions' ? 1.3 : 2.0) + Math.log10(size + 1) * 1.4;
      const main = add(new THREE.Mesh(G.oct, mat(TYPE_COLORS.string, 0.55)));
      main.scale.set(0.8, h, 0.8);
      main.position.y = h * 0.85;
      main.rotation.y = seed * Math.PI;
      main.rotation.z = (seed - 0.5) * 0.25;
      const side = add(new THREE.Mesh(G.oct, mat(TYPE_COLORS.string, 0.28)));
      side.scale.set(0.4, h * 0.45, 0.4);
      side.position.set(Math.cos(seed * 9) * 1.1, h * 0.3, Math.sin(seed * 9) * 1.1);
      side.rotation.z = 0.4;
      break;
    }
    case 'stone': { // counters: squat pulsing domes
      const s = 1.1 + Math.log10(size + 1) * 0.5;
      const dome = add(new THREE.Mesh(G.disc, mat(TYPE_COLORS.stone, 0.55)));
      dome.scale.set(s * 1.4, s * 0.6, s * 1.4);
      dome.position.y = s * 0.25;
      const tip = add(new THREE.Mesh(G.ball, mat(0xffffff, 0.8)));
      tip.scale.setScalar(0.22);
      tip.position.y = s * 0.85;
      break;
    }
    case 'honeycomb': { // hashes: one hex cell per field
      const n = clamp(Math.round(size) || 1, 1, 9);
      const spots = [[0, 0]];
      for (let i = 0; i < 8; i++) spots.push([Math.cos(i * Math.PI / 3 + 0.3) * 2.1, Math.sin(i * Math.PI / 3 + 0.3) * 2.1]);
      for (let i = 0; i < n; i++) {
        const h = 1.4 + ((i * 2.39 + seed * 7) % 2.2);
        const cell = add(new THREE.Mesh(G.hex, mat(TYPE_COLORS.hash, 0.16 + 0.16 * (h / 3.6))));
        cell.scale.set(0.82, h, 0.82);
        cell.position.set(spots[i][0], h / 2, spots[i][1]);
        // a bright nectar core in each cell so cells read as cells
        const tip = add(new THREE.Mesh(G.ball, mat(0xffd98a, 0.9)));
        tip.scale.setScalar(0.16);
        tip.position.set(spots[i][0], h + 0.18, spots[i][1]);
      }
      break;
    }
    case 'worm': { // lists: a rearing segmented creature, one segment per job
      const n = clamp(2 + Math.round(size), 3, 12);
      const arc = new THREE.Group();
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const r = 0.78 * (1 - u * 0.45);
        const seg = new THREE.Mesh(G.ball, mat(TYPE_COLORS.list, i === n - 1 ? 1.0 : 0.45 + u * 0.35));
        seg.userData.keyName = entry.name;
        entry.mats.push(seg.material);
        seg.scale.setScalar(r);
        // body curls up and over like a fern
        const ang = u * Math.PI * 0.95;
        seg.position.set(Math.cos(seed * 6) * u * 0.6, 0.7 + Math.sin(ang) * n * 0.42, -u * 2.2 + Math.cos(ang) * 1.2);
        arc.add(seg);
      }
      arc.rotation.y = seed * Math.PI * 2;
      g.add(arc);
      break;
    }
    case 'spores': { // sets: a mother orb with one orbiting spore per member
      const core = add(new THREE.Mesh(G.ball, mat(TYPE_COLORS.set, 0.5)));
      core.scale.setScalar(0.9);
      core.position.y = 1.4;
      const orbiters = new THREE.Group();
      orbiters.position.y = 1.4;
      const n = clamp(Math.round(size), 1, 12);
      for (let i = 0; i < n; i++) {
        const sp = new THREE.Mesh(G.icosa, mat(TYPE_COLORS.set, 0.9));
        sp.userData.keyName = entry.name;
        entry.mats.push(sp.material);
        sp.scale.setScalar(0.28);
        const a = (i / n) * Math.PI * 2 + seed * 9, tilt = ((i * 2.4) % 1.4) - 0.7;
        sp.position.set(Math.cos(a) * 2.1, Math.sin(tilt) * 1.4, Math.sin(a) * 2.1);
        orbiters.add(sp);
      }
      g.add(orbiters);
      entry.spin = orbiters;
      break;
    }
    case 'helix': { // sorted sets: a spiral spire, one node per member, leader on top
      const n = clamp(Math.round(size), 3, 16);
      const h = 3 + n * 0.85;
      const col = add(new THREE.Mesh(G.column, mat(TYPE_COLORS.zset, 0.35)));
      col.scale.y = h;
      col.position.y = h / 2;
      const spiral = new THREE.Group();
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const node = new THREE.Mesh(G.ball, mat(TYPE_COLORS.zset, 0.4 + u * 0.7));
        node.userData.keyName = entry.name;
        entry.mats.push(node.material);
        node.scale.setScalar(i === n - 1 ? 0.62 : 0.4);
        const a = u * Math.PI * 4 + seed * 7;
        const rad = 2.3 - u * 0.9; // spiral tightens toward the leader
        node.position.set(Math.cos(a) * rad, 0.8 + u * (h - 1.2), Math.sin(a) * rad);
        spiral.add(node);
      }
      g.add(spiral);
      entry.spin = spiral;
      entry.spinRate = 0.12;
      break;
    }
    case 'channel': { // pub/sub: tall aurora kelp with an emitter crown
      const h = 15 + seed * 6;
      for (let i = 0; i < 4; i++) {
        const u = i / 4;
        const seg = add(new THREE.Mesh(G.cone, mat(TYPE_COLORS.channel, 0.22 + u * 0.35)));
        seg.scale.set(1.25 - u * 0.85, h / 4 + 0.8, 1.25 - u * 0.85);
        seg.position.y = (i + 0.5) * (h / 4);
        seg.rotation.y = u * 0.8 + seed * 3;
        seg.rotation.z = Math.sin(seed * 11 + i) * 0.08;
      }
      const crown = add(new THREE.Mesh(G.ball, mat(0xfff2a8, 1.0)));
      crown.scale.setScalar(0.8);
      crown.position.y = h + 0.9;
      entry.crownY = h + 0.9;
      break;
    }
  }
}

function kindFor(type, key) {
  const s = sectorFor(key);
  if (type === 'string') return s.id === 'counters' ? 'stone' : 'crystal';
  return { hash: 'honeycomb', list: 'worm', set: 'spores', zset: 'helix', channel: 'channel' }[type] || 'crystal';
}

export function createKeyspace(scene) {
  const root = new THREE.Group();
  scene.add(root);
  const keys = new Map();
  const pickables = []; // refreshed lazily
  let pickDirty = true;
  let now = 0;

  function ensure(name, type, opts = {}) {
    let e = keys.get(name);
    if (e) {
      if (e.dying) { // resurrection: key recreated before crumble finished
        e.dying = null; e.group.visible = true; e.bornT = now;
      }
      if (type && e.type !== type) { e.type = type; e.kind = kindFor(type, name); e.sizeBuilt = -1; }
      return e;
    }
    if (keys.size >= MAX_KEYS) return null;
    const { sector, pos } = placeKey(name);
    pos.y = heightAt(pos.x, pos.z);
    const group = new THREE.Group();
    group.position.copy(pos);
    e = {
      name, type: type || 'string', sector,
      kind: kindFor(type || 'string', name),
      group, mats: [], size: opts.size ?? 1, sizeBuilt: -1,
      ttlDeadline: null, ttlTotal: null,
      bornT: now, flash: 0, dying: null,
      lastOp: opts.lastOp || null, lastOpT: now,
      baseY: pos.y, phase: hashOf(name) * 6.28,
    };
    keys.set(name, e);
    root.add(group);
    rebuildIfNeeded(e);
    pickDirty = true;
    return e;
  }

  function rebuildIfNeeded(e) {
    // rebuild anatomy only when the structural count changes
    const structural = {
      crystal: Math.round(Math.log10((e.size || 0) + 1) * 4),
      stone: Math.round(Math.log10((e.size || 0) + 1) * 4),
      honeycomb: clamp(Math.round(e.size) || 1, 1, 9),
      worm: clamp(2 + Math.round(e.size), 3, 12),
      spores: clamp(Math.round(e.size), 1, 12),
      helix: clamp(Math.round(e.size), 3, 16),
      channel: 1,
    }[e.kind];
    if (structural !== e.sizeBuilt) {
      buildOrganism(e);
      e.sizeBuilt = structural;
      pickDirty = true;
    }
  }

  function setTTL(e, ms) {
    if (ms == null || ms < 0) { e.ttlDeadline = null; e.ttlTotal = null; return; }
    e.ttlDeadline = performance.now() + ms;
    if (!e.ttlTotal || ms > e.ttlTotal) e.ttlTotal = ms;
  }

  function touch(e, op) {
    e.flash = Math.min(e.flash + 0.9, 2.2);
    e.lastOp = op; e.lastOpT = now;
  }

  function crumble(name) {
    const e = keys.get(name);
    if (!e || e.dying) return e;
    e.dying = { t0: now };
    return e;
  }

  function disposeEntry(e) {
    for (const m of e.mats) m.dispose();
    root.remove(e.group);
    keys.delete(e.name);
    pickDirty = true;
  }

  // ---------- feeds ----------
  function applySnapshot(list, fresh) {
    const seen = new Set();
    for (const [name, type, pttl, size] of list) {
      seen.add(name);
      const e = ensure(name, type, { size });
      if (!e) continue;
      e.size = size;
      setTTL(e, pttl >= 0 ? pttl : null);
      rebuildIfNeeded(e);
    }
    if (fresh) {
      for (const e of [...keys.values()]) {
        if (e.kind !== 'channel' && !seen.has(e.name)) disposeEntry(e);
      }
    }
  }

  // returns an effect descriptor for main.js to render streaks etc.
  function command(ev) {
    const c = ev.c, a = ev.a || [];
    const key = a[0];
    const fx = (action, e, extra = {}) => ({
      action,
      key: e?.name ?? key,
      pos: e ? worldPosOf(e) : null,
      sector: e?.sector ?? (key ? sectorFor(key) : null),
      type: e?.type, ...extra,
    });

    switch (c) {
      case 'GET': case 'MGET': case 'GETRANGE': case 'STRLEN':
      case 'HGET': case 'HGETALL': case 'HMGET':
      case 'SMEMBERS': case 'SISMEMBER':
      case 'ZRANGE': case 'ZREVRANGE': case 'ZSCORE': case 'ZRANK':
      case 'LRANGE': case 'LLEN': {
        const e = keys.get(key);
        if (e) touch(e, c);
        return fx(e ? 'read' : 'miss', e);
      }
      case 'SET': {
        const e = ensure(key, 'string'); if (!e) return fx('write', null);
        e.size = (a[1] || '').length;
        const exIdx = a.findIndex(x => /^(EX|PX)$/i.test(x));
        if (exIdx > 0 && a[exIdx + 1]) setTTL(e, /^EX$/i.test(a[exIdx]) ? a[exIdx + 1] * 1000 : +a[exIdx + 1]);
        touch(e, c); rebuildIfNeeded(e);
        return fx('write', e);
      }
      case 'SETEX': {
        const e = ensure(key, 'string'); if (!e) return fx('write', null);
        setTTL(e, a[1] * 1000); e.size = (a[2] || '').length;
        touch(e, c); rebuildIfNeeded(e);
        return fx('write', e);
      }
      case 'INCR': case 'INCRBY': case 'DECR': case 'DECRBY': {
        const e = ensure(key, 'string'); if (!e) return fx('write', null);
        e.size = (e.size || 0) + (c.startsWith('INCR') ? +(a[1] ?? 1) : 0) + 1;
        touch(e, c); rebuildIfNeeded(e);
        return fx('write', e);
      }
      case 'EXPIRE': case 'PEXPIRE': {
        const e = keys.get(key);
        if (e) { setTTL(e, c === 'EXPIRE' ? a[1] * 1000 : +a[1]); touch(e, c); }
        return fx('write', e);
      }
      case 'HSET': case 'HMSET': {
        const e = ensure(key, 'hash'); if (!e) return fx('write', null);
        e.size = Math.max(e.size || 0, 1) + 0.34; // approx; periodic sizes-refresh corrects
        touch(e, c); rebuildIfNeeded(e);
        return fx('write', e);
      }
      case 'LPUSH': case 'RPUSH': {
        const e = ensure(key, 'list'); if (!e) return fx('write', null);
        e.size = (e.size || 0) + (a.length - 1);
        touch(e, c); rebuildIfNeeded(e);
        return fx('write', e);
      }
      case 'LPOP': case 'RPOP': {
        const e = keys.get(key);
        if (e) { e.size = Math.max(0, (e.size || 0) - 1); touch(e, c); rebuildIfNeeded(e); }
        return fx(e ? 'take' : 'miss', e);
      }
      case 'SADD': {
        const e = ensure(key, 'set'); if (!e) return fx('write', null);
        e.size = (e.size || 0) + (a.length - 1) * 0.6;
        touch(e, c); rebuildIfNeeded(e);
        return fx('write', e);
      }
      case 'SREM': {
        const e = keys.get(key);
        if (e) { e.size = Math.max(0, (e.size || 0) - (a.length - 1)); touch(e, c); rebuildIfNeeded(e); }
        return fx('write', e);
      }
      case 'ZADD': case 'ZINCRBY': {
        const e = ensure(key, 'zset'); if (!e) return fx('write', null);
        e.size = Math.max(e.size || 0, 1) + 0.25;
        touch(e, c); rebuildIfNeeded(e);
        return fx('write', e);
      }
      case 'DEL': case 'UNLINK': {
        const out = [];
        for (const k of a) { const e = crumble(k); if (e) out.push(fx('del', e)); }
        return out[0] || fx('del', null);
      }
      case 'PUBLISH': {
        const e = ensure(key, 'channel', { size: 1 });
        if (e) touch(e, c);
        return fx('pub', e, { crownY: e?.crownY ?? 14 });
      }
      case 'SUBSCRIBE': {
        for (const ch of a) if (/^chat:/.test(ch)) ensure(ch, 'channel', { size: 1 });
        return fx('sys', null);
      }
      case 'BGSAVE': return fx('sys', null);
      default: {
        const e = key ? keys.get(key) : null;
        if (e) touch(e, c);
        return fx(e ? 'write' : 'sys', e);
      }
    }
  }

  function worldPosOf(e) {
    const p = e.group.position.clone();
    p.y += e.kind === 'channel' ? (e.crownY ?? 12) : 2.2;
    return p;
  }

  function gone(name, why) {
    const e = crumble(name);
    return e ? { pos: worldPosOf(e), type: e.type, why } : null;
  }

  function applySizes(list) {
    for (const [name, type, pttl, size] of list) {
      const e = keys.get(name);
      if (!e || e.dying) continue;
      e.size = size;
      if (pttl >= 0) setTTL(e, pttl); else if (pttl === -1) { e.ttlDeadline = null; }
      rebuildIfNeeded(e);
    }
  }

  // ---------- per-frame ----------
  const tmpC = new THREE.Color();
  function update(dt, t) {
    now = t;
    const pnow = performance.now();
    for (const e of [...keys.values()]) {
      if (e.dying) {
        const u = (t - e.dying.t0) / 0.7;
        if (u >= 1) { disposeEntry(e); continue; }
        const s = Math.max(0.001, 1 - u);
        e.group.scale.setScalar(s);
        e.group.position.y = e.baseY - u * 1.5;
        continue;
      }
      // birth pop
      const age = t - e.bornT;
      if (age < 0.7) {
        const u = age / 0.7;
        e.group.scale.setScalar(0.05 + (1 - Math.pow(1 - u, 3)) * 0.95);
      } else if (e.group.scale.x !== 1) e.group.scale.setScalar(1);

      // gentle organic bob
      e.group.position.y = e.baseY + Math.sin(t * 0.8 + e.phase) * 0.12;
      if (e.spin) e.spin.rotation.y += dt * (e.spinRate ?? 0.5);

      // mortality glow: TTL drains the light out of it
      let glow = 1;
      if (e.ttlDeadline != null) {
        const remain = e.ttlDeadline - pnow;
        const f = clamp(remain / (e.ttlTotal || 30000), 0, 1);
        glow = 0.30 + 0.70 * f;
        if (remain < 6000) glow *= 0.6 + 0.4 * Math.sin(t * 16 + e.phase); // death flicker
      }
      e.flash = Math.max(0, e.flash - dt * 2.2);
      const k = glow * (1 + e.flash);
      for (const m of e.mats) {
        tmpC.copy(m.userData.base).multiplyScalar(k);
        if (e.flash > 0.01) tmpC.lerp(WHITE, Math.min(e.flash * 0.25, 0.5));
        m.color.copy(tmpC);
      }
    }
  }

  function getPickables() {
    if (pickDirty) {
      pickables.length = 0;
      for (const e of keys.values()) e.group.traverse(o => { if (o.isMesh) pickables.push(o); });
      pickDirty = false;
    }
    return pickables;
  }

  function inspect(name) {
    const e = keys.get(name);
    if (!e) return null;
    return {
      name: e.name, type: e.type === 'channel' ? 'pub/sub channel' : e.type,
      sector: e.sector,
      ttlMs: e.ttlDeadline != null ? Math.max(0, e.ttlDeadline - performance.now()) : null,
      size: Math.round(e.size), lastOp: e.lastOp, lastAgo: now - e.lastOpT,
    };
  }

  function eachAlive(fn) { for (const e of keys.values()) if (!e.dying && e.kind !== 'channel') fn(worldPosOf(e), e); }

  return { applySnapshot, applySizes, command, gone, update, getPickables, inspect, eachAlive, count: () => keys.size };
}

const WHITE = new THREE.Color(0xffffff);
