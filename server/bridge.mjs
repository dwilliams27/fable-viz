// bridge.mjs — taps a live Redis (MONITOR + keyspace notifications + INFO)
// and streams every event over WebSocket to the 3D world.
// Also hosts the workload generator that keeps the world alive.

import Redis from 'ioredis';
import { WebSocketServer } from 'ws';
import { startWorkload } from './workload.mjs';

const REDIS_PORT = 6390;
const WS_PORT = 7080;

const conn = () => new Redis({ port: REDIS_PORT, lazyConnect: false, maxRetriesPerRequest: null });

const control = conn();   // snapshots, INFO, config
const monitorConn = conn();
const subConn = conn();   // keyspace notifications + chat subscriber (makes pub/sub real)

const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

// ---- batched event fanout (50ms frames so MONITOR bursts don't flood) ----
let frame = [];
function emit(ev) {
  frame.push(ev);
}
setInterval(() => {
  if (frame.length === 0 || clients.size === 0) { frame = []; return; }
  const payload = JSON.stringify({ t: 'batch', evs: frame.splice(0, 400) });
  frame = [];
  for (const ws of clients) if (ws.readyState === 1) ws.send(payload);
}, 50);

function emitNow(ev) {
  const payload = JSON.stringify(ev);
  for (const ws of clients) if (ws.readyState === 1) ws.send(payload);
}

// ---- snapshot: full keyspace with type/ttl/size ----
async function sizeOf(pipe, key, type) {
  switch (type) {
    case 'string': pipe.strlen(key); break;
    case 'hash': pipe.hlen(key); break;
    case 'list': pipe.llen(key); break;
    case 'set': pipe.scard(key); break;
    case 'zset': pipe.zcard(key); break;
    default: pipe.exists(key); break;
  }
}

async function snapshot() {
  const keys = [];
  let cursor = '0';
  do {
    const [next, chunk] = await control.scan(cursor, 'COUNT', 500);
    cursor = next;
    keys.push(...chunk);
  } while (cursor !== '0' && keys.length < 3000);

  if (keys.length === 0) return { t: 'snap', keys: [] };

  const tp = control.pipeline();
  for (const k of keys) tp.type(k);
  const types = (await tp.exec()).map(r => r[1]);

  const sp = control.pipeline();
  for (let i = 0; i < keys.length; i++) { sp.pttl(keys[i]); await sizeOf(sp, keys[i], types[i]); }
  const res = await sp.exec();

  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const pttl = res[i * 2][1];
    const size = res[i * 2 + 1][1];
    out.push([keys[i], types[i], pttl, size]);
  }
  return { t: 'snap', keys: out };
}

// ---- MONITOR: every command Redis executes ----
const SELF_SOURCES = new Set(); // hide bridge's own plumbing (INFO/SCAN polling)
control.client('GETNAME').catch(() => {});
async function markSelf(c, name) {
  try {
    await c.client('SETNAME', name);
    const id = await c.call('CLIENT', 'INFO');
    const addr = /addr=(\S+)/.exec(id)?.[1];
    if (addr) SELF_SOURCES.add(addr);
  } catch { /* fine */ }
}
await markSelf(control, 'bridge-control');
await markSelf(subConn, 'bridge-sub');

const HIDDEN = new Set(['info', 'scan', 'type', 'pttl', 'strlen', 'hlen', 'llen', 'scard', 'zcard', 'client', 'subscribe', 'psubscribe', 'config', 'exists', 'ping', 'select', 'dbsize']);

monitorConn.monitor((err, monitor) => {
  if (err) { console.error('monitor failed', err); process.exit(1); }
  monitor.on('monitor', (time, args, source, database) => {
    const cmd = (args[0] || '').toLowerCase();
    if (SELF_SOURCES.has(source) && HIDDEN.has(cmd)) return;
    if (HIDDEN.has(cmd) && cmd !== 'subscribe') return;
    emit({ t: 'cmd', c: args[0].toUpperCase(), a: args.slice(1, 7).map(s => String(s).slice(0, 80)), s: source, d: Number(database), ts: Math.round(parseFloat(time) * 1000) });
  });
  console.log('MONITOR attached');
});

// ---- keyspace notifications: expired / evicted ----
await subConn.psubscribe('__keyevent@0__:expired', '__keyevent@0__:evicted');
subConn.on('pmessage', (_pat, channel, key) => {
  const kind = channel.endsWith('expired') ? 'expired' : 'evicted';
  emit({ t: 'gone', k: key, why: kind });
});

// ---- a real chat subscriber so PUBLISH has receivers ----
const chatSub = conn();
await markSelf(chatSub, 'bridge-chat-sub');
await chatSub.subscribe('chat:plaza', 'chat:hive', 'chat:abyss');
chatSub.on('message', () => { /* presence is the point */ });

// ---- INFO polling -> stats heartbeat ----
let lastSaveInProgress = 0;
setInterval(async () => {
  try {
    const info = await control.info();
    const g = (k) => { const m = new RegExp('^' + k + ':(.*)$', 'm').exec(info); return m ? m[1].trim() : null; };
    const saveInProgress = Number(g('rdb_bgsave_in_progress') || 0);
    if (saveInProgress !== lastSaveInProgress) {
      emitNow({ t: 'save', phase: saveInProgress ? 'start' : 'done' });
      lastSaveInProgress = saveInProgress;
    }
    const dbsize = await control.dbsize();
    emitNow({
      t: 'info',
      ops: Number(g('instantaneous_ops_per_sec') || 0),
      mem: Number(g('used_memory') || 0),
      memh: g('used_memory_human'),
      clients: Number(g('connected_clients') || 0),
      hits: Number(g('keyspace_hits') || 0),
      misses: Number(g('keyspace_misses') || 0),
      keys: dbsize,
      uptime: Number(g('uptime_in_seconds') || 0),
    });
  } catch (e) { /* redis restarting */ }
}, 1000);

// ---- periodic size refresh so organism scale stays honest ----
setInterval(async () => {
  try {
    const snap = await snapshot();
    emitNow({ t: 'sizes', keys: snap.keys });
  } catch { }
}, 15000);

wss.on('connection', async (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  try {
    const snap = await snapshot();
    ws.send(JSON.stringify(snap));
  } catch (e) { console.error('snapshot failed', e); }
});

console.log(`bridge: ws://localhost:${WS_PORT}  redis://localhost:${REDIS_PORT}`);

// ---- the living workload ----
startWorkload(REDIS_PORT);
