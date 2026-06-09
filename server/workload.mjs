// workload.mjs — "Nectar", a simulated social app that keeps the world alive.
// Sessions, profile hashes, page caches, leaderboards, job queues, tag sets,
// rate counters, pub/sub chat — all real Redis traffic, paced for watchability.

import Redis from 'ioredis';

const USERS = ['lyra', 'voss', 'ember', 'kael', 'nyx', 'orin', 'sable', 'thorn', 'iris', 'mira', 'dax', 'rune'];
const TOPICS = ['flux', 'spores', 'driftwood', 'emberglass', 'voidsilk', 'chitin'];
const CHANNELS = ['chat:plaza', 'chat:hive', 'chat:abyss'];
const PAGES = 14;

const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const jitter = (ms) => ms / 2 + Math.random() * ms;

export function startWorkload(port) {
  const r = new Redis({ port, maxRetriesPerRequest: null });
  const worker = new Redis({ port, maxRetriesPerRequest: null });

  // a few persistent "extra clients" so the reef has inhabitants
  const drones = Array.from({ length: 3 }, () => new Redis({ port, maxRetriesPerRequest: null }));

  const loop = (fn, ms) => {
    const tick = async () => {
      try { await fn(); } catch { }
      setTimeout(tick, jitter(ms));
    };
    setTimeout(tick, jitter(ms));
  };

  // -- sessions: mayflies. born with a TTL, die visibly --
  loop(async () => {
    const u = pick(USERS);
    await r.set(`session:${u}:${rnd(999)}`, `tok:${Math.random().toString(36).slice(2)}`, 'EX', 25 + rnd(90));
  }, 2500);

  // -- profiles: honeycomb hashes, occasionally grown --
  loop(async () => {
    const u = pick(USERS);
    const fields = ['bio', 'glyph', 'hue', 'wing', 'song', 'home', 'caste'];
    await r.hset(`user:${u}`, pick(fields), Math.random().toString(36).slice(2, 8));
    if (Math.random() < 0.4) await r.hgetall(`user:${u}`);
  }, 1800);

  // -- page cache: read-heavy, misses refill --
  loop(async () => {
    const p = `cache:page:${rnd(PAGES)}`;
    const hit = await pick(drones).get(p);
    if (!hit) await r.set(p, 'x'.repeat(200 + rnd(2000)), 'EX', 20 + rnd(70));
  }, 600);

  // -- leaderboards: spiral spires --
  loop(async () => {
    const board = pick(['leaderboard:global', 'leaderboard:weekly', 'leaderboard:spores']);
    await r.zincrby(board, 1 + rnd(20), pick(USERS));
    if (Math.random() < 0.3) await r.zrevrange(board, 0, 4, 'WITHSCORES');
  }, 1400);

  // -- job queue: producer here, worker drains --
  loop(async () => {
    const q = pick(['queue:emails', 'queue:exports']);
    await r.lpush(q, JSON.stringify({ id: rnd(99999), kind: pick(['welcome', 'digest', 'alert']) }));
  }, 2400);
  loop(async () => { // worker drains whichever queue is longer
    const [a, b] = await Promise.all([worker.llen('queue:emails'), worker.llen('queue:exports')]);
    if (a + b === 0) return;
    await worker.rpop(a >= b ? 'queue:emails' : 'queue:exports');
  }, 1300);

  // -- tags: spore clusters --
  loop(async () => {
    await r.sadd(`tags:${pick(TOPICS)}`, pick(USERS));
    if (Math.random() < 0.25) await r.smembers(`tags:${pick(TOPICS)}`);
    if (Math.random() < 0.1) await r.srem(`tags:${pick(TOPICS)}`, pick(USERS));
  }, 2100);

  // -- presence set with churn --
  loop(async () => {
    if (Math.random() < 0.5) await r.sadd('online', pick(USERS));
    else await r.srem('online', pick(USERS));
  }, 3000);

  // -- rate limit counters: short-lived pulse stones --
  loop(async () => {
    const k = `rate:api:${pick(USERS)}`;
    await r.incr(k);
    await r.expire(k, 10);
  }, 900);

  // -- global stats counters --
  loop(async () => { await r.incrby('stats:pageviews', 1 + rnd(5)); }, 1100);
  loop(async () => { await r.incr('stats:signals'); }, 4000);

  // -- chat: pub/sub auroras --
  loop(async () => {
    await r.publish(pick(CHANNELS), `${pick(USERS)}: ${pick(['the spores are singing', 'tide coming in', 'found emberglass', 'who moved my larva', 'nucleus is bright tonight'])}`);
  }, 2800);

  // -- occasional deliberate deletion --
  loop(async () => {
    const u = pick(USERS);
    if (Math.random() < 0.3) await r.del(`session:${u}:${rnd(999)}`);
  }, 8000);

  // -- swarm event: a traffic spike every ~50s --
  loop(async () => {
    const n = 25 + rnd(25);
    for (let i = 0; i < n; i++) {
      setTimeout(async () => {
        try {
          const roll = Math.random();
          if (roll < 0.4) await pick(drones).get(`cache:page:${rnd(PAGES)}`);
          else if (roll < 0.7) await r.zincrby('leaderboard:global', rnd(9), pick(USERS));
          else await r.incr(`rate:api:${pick(USERS)}`);
        } catch { }
      }, i * 60);
    }
  }, 50000);

  // -- the fork ritual: BGSAVE every ~100s --
  loop(async () => { try { await r.bgsave(); } catch { } }, 100000);

  console.log('workload: Nectar is alive');
}
