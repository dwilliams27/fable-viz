// main.js — wires the live Redis event stream into the world.

import * as THREE from 'three';
import { createWorld } from './world.js';
import { createKeyspace } from './keyspace.js';
import { createEffects } from './effects.js';
import { createControls } from './controls.js';
import { createHud } from './hud.js';
import { connect } from './net.js';
import { TYPE_COLORS, SECTORS, BAND, REEF, VAULT, NUCLEUS_POS } from './sectors.js';

const world = createWorld(document.getElementById('app'));
const keyspace = createKeyspace(world.scene);
const effects = createEffects(world.scene, world);
const controls = createControls(world.camera, world.renderer.domElement);
const hud = createHud();

// intro
const intro = document.getElementById('intro');
intro.addEventListener('click', () => {
  intro.classList.add('hidden');
  if (!controls.isDemo) world.renderer.domElement.requestPointerLock();
});
if (controls.isDemo) setTimeout(() => intro.classList.add('hidden'), 800);

// ---------- event routing: every Redis event becomes light ----------
let firstSnap = true;

connect({
  status: (s) => hud.setConn(s),

  snapshot: (list) => {
    keyspace.applySnapshot(list, true);
    if (firstSnap) { firstSnap = false; }
  },

  sizes: (list) => keyspace.applySizes(list),

  command: (ev) => {
    const fx = keyspace.command(ev);
    world.nucleusBeat(0.10);
    hud.tick(ev, fx.action);
    if (fx.sector) world.tendrilFlow(fx.sector.id, 0.55);

    const client = world.reefPoint(ev.s);
    const nuc = NUCLEUS_POS.clone();
    const typeColor = TYPE_COLORS[fx.type] ?? 0x4de8ff;

    switch (fx.action) {
      case 'write': {
        if (fx.pos) {
          effects.streak([client, nuc, fx.pos], typeColor, { dur: 1.0, width: 1.1 });
        } else {
          effects.streak([client, nuc], typeColor, { dur: 0.7, width: 0.8 });
        }
        break;
      }
      case 'read': {
        if (fx.pos) effects.streak([fx.pos, nuc, client], 0xcdf6ff, { dur: 0.85, width: 0.7 });
        break;
      }
      case 'take': { // a job pulled off a queue: the worm gives up a segment
        if (fx.pos) {
          effects.streak([fx.pos, nuc, client], TYPE_COLORS.list, { dur: 0.9, width: 1.0 });
          effects.burst(fx.pos, TYPE_COLORS.list, 8, 4, 3);
        }
        break;
      }
      case 'miss': {
        effects.streak([client, nuc], 0x32505e, { dur: 0.8, width: 0.6 });
        break;
      }
      case 'del': {
        if (fx.pos) {
          effects.streak([client, nuc, fx.pos], 0xff5e5e, { dur: 0.7, width: 1.0 });
          setTimeout(() => effects.burst(fx.pos, 0xff5e5e, 26, 8, 5), 600);
        }
        break;
      }
      case 'pub': {
        if (fx.pos) {
          effects.streak([client, nuc, fx.pos], TYPE_COLORS.channel, { dur: 0.8, width: 1.2 });
          const crown = fx.pos.clone();
          setTimeout(() => {
            effects.ring(crown, TYPE_COLORS.channel, { maxR: 34, dur: 2.0 });
            effects.ring(crown, 0xfff6c8, { maxR: 20, dur: 1.3, tilt: 0.35 });
            // deliver to the subscriber on the shore
            effects.streak([crown, nuc, world.reefPoint('subscriber')], 0xfff2a8, { dur: 1.1, width: 0.8 });
          }, 750);
        }
        break;
      }
      default: {
        effects.streak([client, nuc], 0x3a6f80, { dur: 0.7, width: 0.6 });
      }
    }

    if (ev.c === 'BGSAVE') hud.toast('FORK RITUAL INVOKED — BGSAVE', 2500);
  },

  gone: (key, why) => {
    const g = keyspace.gone(key, why);
    if (g) {
      effects.burst(g.pos, why === 'expired' ? 0xff9c40 : 0xff5e5e, 30, 7, 6);
      hud.sysLine(`<span class="verb" style="color:#ff9c40">⨯ ${why.toUpperCase()}</span> <span style="color:#7fa8b5">${key}</span>`);
    }
  },

  info: (m) => {
    hud.setStats(m, keyspace.count());
    world.setOps(m.ops);
    world.setMemory(m.mem);
  },

  save: (phase) => {
    if (phase === 'start') {
      effects.startWave();
      hud.toast('THE FORK WAVE — COPYING THE WORLD TO THE VAULT', 4000);
    } else {
      world.vaultFlash();
      hud.toast('SNAPSHOT SEALED IN THE VAULT', 3000);
    }
  },
});

// ---------- BGSAVE wave ghosting: keys the wavefront crosses get archived ----------
function ghostSweep() {
  const band = effects.waveBand();
  if (!band) return;
  keyspace.eachAlive((pos) => {
    const d = Math.hypot(pos.x, pos.z);
    if (d >= band[0] && d < band[1]) effects.ghost(pos);
  });
}

// ---------- inspector: look at an organism to read it ----------
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
let inspectClock = 0;
function inspectUpdate(dt) {
  inspectClock += dt;
  if (inspectClock < 0.12) return;
  inspectClock = 0;
  raycaster.setFromCamera({ x: 0, y: 0 }, world.camera);
  const hits = raycaster.intersectObjects(keyspace.getPickables(), false);
  const name = hits.find(h => h.object.userData.keyName)?.object.userData.keyName;
  hud.inspect(name ? keyspace.inspect(name) : null);
}

// ---------- biome announcements ----------
function zoneUpdate() {
  const p = controls.getPos();
  const r = Math.hypot(p.x, p.z);
  if (r < 30) return hud.zone('The Nucleus', 'the event loop · every command passes through');
  if (p.distanceTo(new THREE.Vector3(VAULT.x, p.y, VAULT.z)) < 34) return hud.zone('The Vault', 'RDB snapshots · the world, remembered');
  const reefC = new THREE.Vector3(Math.cos(REEF.angle) * REEF.radius, p.y, Math.sin(REEF.angle) * REEF.radius);
  if (p.distanceTo(reefC) < 38) return hud.zone('The Client Shore', 'connected clients · where commands are born');
  if (r >= BAND.inner - 12 && r <= BAND.outer + 14) {
    let ang = Math.atan2(p.z, p.x);
    if (ang < 0) ang += Math.PI * 2;
    let best = null, bd = 9;
    for (const s of SECTORS) {
      let d = Math.abs(ang - s.angle);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < bd) { bd = d; best = s; }
    }
    if (best && bd < Math.PI / 8) return hud.zone(best.label, best.sub);
  }
  hud.zone(null);
}
setInterval(zoneUpdate, 700);

// ---------- debug / screenshot API ----------
window.__viz = {
  cam: (x, y, z, lx = 0, ly = 12, lz = 0) => {
    const yaw = Math.atan2(-(lx - x), -(lz - z));
    const pitch = Math.atan2(ly - y, Math.hypot(lx - x, lz - z));
    controls.teleport(x, y, z, yaw, pitch);
  },
  keys: () => keyspace.count(),
  wave: () => effects.startWave(),
  waveActive: () => effects.waveActive(),
  debugWave: () => effects.debugWave(),
  find: (prefix) => {
    const out = [];
    keyspace.eachAlive((pos, e) => { if (e.name.startsWith(prefix)) out.push({ name: e.name, kind: e.kind, x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1), size: e.size }); });
    return out;
  },
};

// ---------- the loop ----------
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  controls.update(dt, t);
  world.update(dt, t);
  keyspace.update(dt, t);
  ghostSweep();
  effects.update(dt, t);
  inspectUpdate(dt);
  world.composer.render();
}
frame();
