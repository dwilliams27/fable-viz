// hud.js — diegetic-ish overlay: live INFO stats, command ticker, organism inspector,
// biome announcements, ritual toasts.

const $ = (id) => document.getElementById(id);

const ACTION_COLORS = {
  read: '#9fdcff', write: '#4de8ff', take: '#ff4dd2', del: '#ff5e5e',
  pub: '#ffe44d', miss: '#5d7f8c', sys: '#5d7f8c', expired: '#ff9c40', evicted: '#ff5e5e',
};

const TYPE_HEX = { string: '#4de8ff', hash: '#ffb347', list: '#ff4dd2', set: '#7dff6a', zset: '#b07aff' };

export function createHud() {
  const stats = $('stats'), ticker = $('ticker'), inspect = $('inspect'),
        zone = $('zone'), toast = $('toast'), legend = $('legend'), conn = $('connstate');

  legend.innerHTML = [
    ['string · crystal', '#4de8ff'], ['hash · honeycomb', '#ffb347'], ['list · worm', '#ff4dd2'],
    ['set · spores', '#7dff6a'], ['zset · spire', '#b07aff'], ['pub/sub · aurora', '#ffe44d'],
  ].map(([t, c]) => `<div>${t}<span class="sw" style="color:${c}"></span></div>`).join('');

  const lines = [];
  let zoneTimer = null, toastTimer = null, lastZone = null;

  function fmtBytes(b) {
    if (b > 1048576) return (b / 1048576).toFixed(1) + 'M';
    if (b > 1024) return (b / 1024).toFixed(0) + 'K';
    return b + 'B';
  }

  return {
    setConn(s) { if (conn) conn.textContent = s === 'linked' ? 'bridge linked — the world is live' : 'bridge lost — reconnecting…'; },

    setStats(m, keyCount) {
      const hitRate = (m.hits + m.misses) > 0 ? Math.round(m.hits / (m.hits + m.misses) * 100) : 0;
      stats.innerHTML =
        `<b>${m.ops}</b> <span class="dim">ops/sec</span><br>` +
        `<b>${m.keys}</b> <span class="dim">keys alive</span> <span class="dim">(${keyCount} rendered)</span><br>` +
        `<b>${fmtBytes(m.mem)}</b> <span class="dim">memory · see the moon</span><br>` +
        `<b>${m.clients}</b> <span class="dim">clients on the shore</span><br>` +
        `<b>${hitRate}%</b> <span class="dim">cache hit</span>`;
    },

    tick(ev, action) {
      const color = action === 'write' && ev.c !== 'DEL' ? (TYPE_HEX[guessType(ev.c)] || ACTION_COLORS.write) : (ACTION_COLORS[action] || '#9fdcff');
      lines.unshift({ html: `<span class="verb" style="color:${color}">${ev.c}</span> <span style="color:#7fa8b5">${(ev.a || []).slice(0, 2).join(' ').slice(0, 60)}</span>`, t: performance.now() });
      if (lines.length > 9) lines.pop();
      ticker.innerHTML = lines.map((l, i) => `<div style="opacity:${Math.max(0.15, 1 - i * 0.11)}">${l.html}</div>`).join('');
    },

    sysLine(html) {
      lines.unshift({ html, t: performance.now() });
      if (lines.length > 9) lines.pop();
      ticker.innerHTML = lines.map((l, i) => `<div style="opacity:${Math.max(0.15, 1 - i * 0.11)}">${l.html}</div>`).join('');
    },

    inspect(info) {
      if (!info) { inspect.style.opacity = 0; return; }
      const ttl = info.ttlMs != null ? `dies in ${(info.ttlMs / 1000).toFixed(1)}s` : 'immortal';
      const ttlColor = info.ttlMs != null && info.ttlMs < 8000 ? '#ff9c40' : '#7fa8b5';
      inspect.innerHTML =
        `<div class="t" style="color:${TYPE_HEX[info.type] || '#ffe44d'}">${info.type}</div>` +
        `<div class="k">${info.name}</div>` +
        `<div><span style="color:#7fa8b5">size ${info.size}</span> · <span style="color:${ttlColor}">${ttl}</span>` +
        (info.lastOp ? ` · <span style="color:#7fa8b5">last ${info.lastOp} ${info.lastAgo < 2 ? 'now' : Math.round(info.lastAgo) + 's ago'}</span>` : '') + `</div>`;
      inspect.style.opacity = 1;
    },

    zone(label, sub) {
      if (label === lastZone) return;
      lastZone = label;
      if (!label) { zone.style.opacity = 0; return; }
      zone.innerHTML = `${label}<span class="sub">${sub || ''}</span>`;
      zone.style.opacity = 1;
      clearTimeout(zoneTimer);
      zoneTimer = setTimeout(() => { zone.style.opacity = 0; lastZone = null; }, 5000);
    },

    toast(msg, ms = 3000) {
      toast.textContent = msg;
      toast.style.opacity = 1;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.style.opacity = 0; }, ms);
    },
  };
}

function guessType(c) {
  if (/^(H)/.test(c)) return 'hash';
  if (/^(L|R)P/.test(c)) return 'list';
  if (/^S(ADD|REM|MEM)/.test(c)) return 'set';
  if (/^Z/.test(c)) return 'zset';
  return 'string';
}
