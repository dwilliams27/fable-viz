// effects.js — transient light: command streaks, death bursts, pub/sub auroras,
// and the fork-wave that copies the world into the Vault on BGSAVE.

import * as THREE from 'three';

function pointsMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: /* glsl */`
      attribute float psize;
      attribute vec3 pcolor;
      varying vec3 vC;
      void main(){
        vC = pcolor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(psize * (220.0 / -mv.z), 56.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.02, d);
        gl_FragColor = vec4(vC * a, a);
      }`,
  });
}

function makePointPool(scene, n) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('psize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const pts = new THREE.Points(geo, pointsMaterial());
  pts.frustumCulled = false;
  scene.add(pts);
  return { geo, pos, col, size };
}

export function createEffects(scene, world) {
  // ---------- streaks: a head with a comet tail riding a curve ----------
  const MAX_S = 110, TRAIL = 18;
  const sPool = makePointPool(scene, MAX_S * TRAIL);
  const streaks = Array.from({ length: MAX_S }, () => ({ active: false }));
  let sCursor = 0;

  function streak(pts3, color, { dur = 1.1, width = 1 } = {}) {
    const s = streaks[sCursor];
    sCursor = (sCursor + 1) % MAX_S;
    s.active = true;
    s.curve = new THREE.CatmullRomCurve3(pts3);
    s.t0 = nowT; s.dur = dur; s.width = width;
    s.color = new THREE.Color(color);
  }

  // ---------- bursts: physics particles for deaths / impacts ----------
  const MAX_B = 1400;
  const bPool = makePointPool(scene, MAX_B);
  const bursts = Array.from({ length: MAX_B }, () => ({ life: 0 }));
  let bCursor = 0;

  function burst(p, color, n = 24, speed = 7, up = 4) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const b = bursts[bCursor];
      bCursor = (bCursor + 1) % MAX_B;
      b.x = p.x; b.y = p.y; b.z = p.z;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const sp = speed * (0.4 + Math.random() * 0.8);
      b.vx = Math.sin(ph) * Math.cos(th) * sp;
      b.vy = Math.cos(ph) * sp * 0.6 + up;
      b.vz = Math.sin(ph) * Math.sin(th) * sp;
      b.life = b.maxLife = 0.7 + Math.random() * 0.8;
      b.r = c.r; b.g = c.g; b.b = c.b;
      b.size = 1.5 + Math.random() * 2.0;
    }
  }

  // ---------- ghosts: silhouettes carried to the Vault during BGSAVE ----------
  const MAX_G = 320;
  const gPool = makePointPool(scene, MAX_G);
  const ghosts = Array.from({ length: MAX_G }, () => ({ active: false }));
  let gCursor = 0;

  function ghost(p) {
    const g = ghosts[gCursor];
    gCursor = (gCursor + 1) % MAX_G;
    g.active = true;
    g.sx = p.x; g.sy = p.y; g.sz = p.z;
    g.t0 = nowT;
    g.dur = 3.2 + Math.random() * 2.2;
  }

  // ---------- rings: expanding auroras (pub/sub) ----------
  const rings = [];
  const ringGeo = new THREE.RingGeometry(0.92, 1.0, 56);
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffe44d, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    scene.add(m);
    rings.push({ mesh: m, active: false });
  }
  function ring(p, color, { maxR = 30, dur = 1.8, tilt = 0 } = {}) {
    const r = rings.find(r => !r.active) || rings[0];
    r.active = true; r.t0 = nowT; r.dur = dur; r.maxR = maxR;
    r.mesh.position.copy(p);
    r.mesh.rotation.x = -Math.PI / 2 + tilt;
    r.mesh.material.color.set(color);
    r.mesh.visible = true;
  }

  // ---------- the fork wave (BGSAVE sweeping the keyspace) ----------
  const waveMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uA: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      uniform float uA;
      void main(){
        float band = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
        vec3 col = vec3(0.60, 0.42, 1.0) * band * uA * 0.38;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  // an expanding curtain of violet light: the fork scanning the keyspace
  const waveMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 22, 72, 1, true), waveMat);
  waveMesh.position.set(0, 8, 0);
  waveMesh.visible = false;
  waveMesh.frustumCulled = false;
  scene.add(waveMesh);
  let wave = null; // { t0 }
  const WAVE_SPEED = 27;

  function startWave() { wave = { t0: nowT, last: 0 }; waveMesh.visible = true; }
  function waveBand() {
    if (!wave) return null;
    const r = (nowT - wave.t0) * WAVE_SPEED;
    const band = [wave.last, r];
    wave.last = r;
    return band;
  }

  let nowT = 0;
  function update(dt, t) {
    nowT = t;

    // streaks
    const sp = sPool;
    for (let si = 0; si < MAX_S; si++) {
      const s = streaks[si];
      const base = si * TRAIL;
      if (!s.active) continue;
      const u = (t - s.t0) / s.dur;
      if (u > 1.35) {
        s.active = false;
        for (let i = 0; i < TRAIL; i++) sp.size[base + i] = 0;
        continue;
      }
      for (let i = 0; i < TRAIL; i++) {
        const ui = Math.min(Math.max(u - i * 0.018, 0), 1);
        const e = ui * ui * (3 - 2 * ui);
        const p = s.curve.getPoint(e);
        const j = (base + i) * 3;
        sp.pos[j] = p.x; sp.pos[j + 1] = p.y; sp.pos[j + 2] = p.z;
        let f = Math.pow(1 - i / TRAIL, 1.7);
        if (u > 1) f *= Math.max(0, 1 - (u - 1) * 3);
        sp.col[j] = s.color.r * f; sp.col[j + 1] = s.color.g * f; sp.col[j + 2] = s.color.b * f;
        sp.size[base + i] = s.width * (i === 0 ? 4.2 : 2.6 * f);
      }
    }
    sp.geo.attributes.position.needsUpdate = true;
    sp.geo.attributes.pcolor.needsUpdate = true;
    sp.geo.attributes.psize.needsUpdate = true;

    // bursts
    for (let i = 0; i < MAX_B; i++) {
      const b = bursts[i], j = i * 3;
      if (b.life <= 0) { bPool.size[i] = 0; continue; }
      b.life -= dt;
      b.vy -= 13 * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      const f = Math.max(0, b.life / b.maxLife);
      bPool.pos[j] = b.x; bPool.pos[j + 1] = b.y; bPool.pos[j + 2] = b.z;
      bPool.col[j] = b.r * f; bPool.col[j + 1] = b.g * f; bPool.col[j + 2] = b.b * f;
      bPool.size[i] = b.size * f;
    }
    bPool.geo.attributes.position.needsUpdate = true;
    bPool.geo.attributes.pcolor.needsUpdate = true;
    bPool.geo.attributes.psize.needsUpdate = true;

    // ghosts -> vault
    const vt = world.vaultTop;
    for (let i = 0; i < MAX_G; i++) {
      const g = ghosts[i], j = i * 3;
      if (!g.active) { gPool.size[i] = 0; continue; }
      const u = (t - g.t0) / g.dur;
      if (u >= 1) { g.active = false; gPool.size[i] = 0; world.vaultFlash(); continue; }
      const e = u * u * (3 - 2 * u);
      gPool.pos[j] = g.sx + (vt.x - g.sx) * e;
      gPool.pos[j + 1] = g.sy + (vt.y - g.sy) * e + Math.sin(Math.PI * e) * 14;
      gPool.pos[j + 2] = g.sz + (vt.z - g.sz) * e;
      const f = Math.sin(Math.PI * Math.min(u * 1.15, 1));
      gPool.col[j] = 0.62 * f; gPool.col[j + 1] = 0.45 * f; gPool.col[j + 2] = 1.0 * f;
      gPool.size[i] = 5.2 * (1 - e * 0.5);
    }
    gPool.geo.attributes.position.needsUpdate = true;
    gPool.geo.attributes.pcolor.needsUpdate = true;
    gPool.geo.attributes.psize.needsUpdate = true;

    // rings
    for (const r of rings) {
      if (!r.active) continue;
      const u = (t - r.t0) / r.dur;
      if (u >= 1) { r.active = false; r.mesh.visible = false; r.mesh.material.opacity = 0; continue; }
      const e = 1 - Math.pow(1 - u, 2.2);
      r.mesh.scale.setScalar(Math.max(0.01, r.maxR * e));
      r.mesh.material.opacity = 0.85 * (1 - u);
    }

    // wave
    if (wave) {
      const r = (t - wave.t0) * WAVE_SPEED;
      if (r > 210) { wave = null; waveMesh.visible = false; }
      else {
        waveMesh.scale.set(Math.max(0.01, r), 1, Math.max(0.01, r));
        waveMat.uniforms.uA.value = 0.55 * (1 - r / 210);
      }
    }
  }

  return {
    streak, burst, ghost, ring, startWave, waveBand, update, waveActive: () => !!wave,
    debugWave: () => ({ active: !!wave, visible: waveMesh.visible, scale: waveMesh.scale.x, uA: waveMat.uniforms.uA.value, pos: waveMesh.position.toArray() }),
  };
}
