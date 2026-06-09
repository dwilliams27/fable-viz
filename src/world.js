// world.js — the planet itself: veined terrain, sky, the event-loop Nucleus,
// tendrils to each biome, the client Reef, the Vault (RDB archive), ambient spores.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SECTORS, sectorCenter, NUCLEUS_POS, VAULT, REEF } from './sectors.js';

export const FOG_COLOR = 0x04060d;

// ---------- terrain height (shared with controls for walking) ----------
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = 2.2 * Math.sin(x * 0.045 + 1.7) * Math.cos(z * 0.038)
        + 1.4 * Math.sin((x + z) * 0.07 + 0.5)
        + 0.8 * Math.sin(x * 0.11) * Math.sin(z * 0.13);
  const flat = Math.min(1, Math.max(0, (r - 12) / 30)); // calm basin under the nucleus
  return h * (0.25 + 0.75 * flat);
}

export function makeGlowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner); grad.addColorStop(0.35, inner.replace(',1)', ',0.45)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const NOISE_GLSL = /* glsl */`
  float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1,0)), u.x),
               mix(hash2(i + vec2(0,1)), hash2(i + vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ v += a * vnoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

export function createWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0042);

  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 2000);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.32);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  });

  scene.add(new THREE.HemisphereLight(0x1a3a52, 0x05070d, 0.7));

  // ---------- terrain with living veins ----------
  const terrainGeo = new THREE.PlaneGeometry(560, 560, 170, 170);
  terrainGeo.rotateX(-Math.PI / 2);
  const tp = terrainGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) tp.setY(i, heightAt(tp.getX(i), tp.getZ(i)));
  terrainGeo.computeVertexNormals();

  const sectorCenters = SECTORS.map(s => sectorCenter(s));
  const terrainMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCenters: { value: sectorCenters.map(c => new THREE.Vector2(c.x, c.z)) },
      uFog: { value: new THREE.Color(FOG_COLOR) },
    },
    vertexShader: /* glsl */`
      varying vec3 vPos;
      void main(){
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vPos;
      uniform float uTime;
      uniform vec2 uCenters[8];
      uniform vec3 uFog;
      ${NOISE_GLSL}
      void main(){
        vec3 col = vec3(0.006, 0.011, 0.022);
        float n = fbm(vPos.xz * 0.055 + vec2(uTime * 0.012, -uTime * 0.009));
        float vein = pow(smoothstep(0.955, 0.999, abs(sin(n * 9.42477))), 2.0);
        vec3 veinCol = mix(vec3(0.05, 0.85, 0.75), vec3(0.45, 0.25, 0.95), vnoise(vPos.xz * 0.02));
        col += veinCol * vein * (0.16 + 0.10 * sin(uTime * 0.8 + n * 12.0));
        // faint halo under each biome
        for (int i = 0; i < 8; i++){
          float d = distance(vPos.xz, uCenters[i]);
          col += vec3(0.035, 0.07, 0.09) * smoothstep(40.0, 6.0, d) * 0.18;
        }
        float r = length(vPos.xz);
        col = mix(col, uFog, smoothstep(200.0, 270.0, r));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(terrainGeo, terrainMat));

  // ---------- sky dome ----------
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform float uTime;
      ${NOISE_GLSL}
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(vec3(0.030, 0.075, 0.115), vec3(0.004, 0.006, 0.016), pow(h, 0.45));
        float neb = fbm(vDir.xz / max(vDir.y + 0.25, 0.12) * 1.4 + vec2(uTime * 0.004, 0.0));
        col += vec3(0.10, 0.04, 0.18) * pow(neb, 2.4) * smoothstep(0.02, 0.45, h);
        vec2 cell = floor(vDir.xz / max(vDir.y + 0.08, 0.05) * 60.0);
        float star = step(0.9962, hash2(cell));
        float tw = 0.55 + 0.45 * sin(uTime * (1.0 + hash2(cell + 7.0) * 3.0) + hash2(cell + 3.0) * 40.0);
        col += vec3(0.8, 0.9, 1.0) * star * tw * smoothstep(0.04, 0.25, h) * 0.8;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMat));

  // ---------- Memory Moon (used_memory made celestial) ----------
  const moonMat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(0x9a6cff) }, uGlow: { value: 0.35 } },
    vertexShader: /* glsl */`
      varying vec3 vN, vV, vP;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz); vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vN, vV, vP;
      uniform vec3 uColor;
      uniform float uGlow;
      ${NOISE_GLSL}
      void main(){
        float limb = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 0.7);
        float mottle = 0.55 + 0.45 * fbm(vP.xy * 0.09 + vP.z * 0.05);
        vec3 col = uColor * limb * mottle * (0.35 + uGlow);
        col += uColor * pow(1.0 - limb, 2.0) * 0.35; // rim haze
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const moon = new THREE.Mesh(new THREE.SphereGeometry(38, 48, 32), moonMat);
  moon.position.set(330, 380, -460);
  scene.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0x8a5cff, transparent: true, opacity: 0.30,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  moonHalo.scale.setScalar(150); moonHalo.position.copy(moon.position);
  scene.add(moonHalo);

  // ---------- the Nucleus: Redis's event loop, beating ----------
  const nucleus = new THREE.Group();
  nucleus.position.copy(NUCLEUS_POS);
  const coreMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBeat: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uTime, uBeat;
      varying float vGlow;
      varying vec3 vN, vV;
      float hash3(vec3 p){ return fract(sin(dot(p, vec3(12.989, 78.233, 37.719))) * 43758.5453); }
      float n3(vec3 p){
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash3(i), hash3(i+vec3(1,0,0)), u.x), mix(hash3(i+vec3(0,1,0)), hash3(i+vec3(1,1,0)), u.x), u.y),
          mix(mix(hash3(i+vec3(0,0,1)), hash3(i+vec3(1,0,1)), u.x), mix(hash3(i+vec3(0,1,1)), hash3(i+vec3(1,1,1)), u.x), u.y), u.z);
      }
      void main(){
        float n = n3(normalize(position) * 2.6 + uTime * 0.45);
        float d = (n - 0.5) * (1.3 + uBeat * 2.2);
        vec3 p = position + normal * d;
        vGlow = n;
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uBeat;
      varying float vGlow;
      varying vec3 vN, vV;
      void main(){
        float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        vec3 deep = vec3(0.015, 0.10, 0.16);
        vec3 hot  = vec3(0.45, 0.95, 1.0);
        vec3 col = mix(deep, hot, clamp(fres * 1.1 + vGlow * 0.18 + uBeat * 0.55, 0.0, 1.1));
        col *= 0.85 + 0.18 * sin(uTime * 2.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  nucleus.add(new THREE.Mesh(new THREE.IcosahedronGeometry(7, 24), coreMat));

  const ringMat = new THREE.MeshBasicMaterial({ color: 0x6ff2ff });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(11.5, 0.14, 8, 96), ringMat);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(13.5, 0.10, 8, 96), ringMat.clone());
  ring2.material.color.set(0xb07aff);
  ring1.rotation.x = Math.PI / 2.4; ring2.rotation.x = Math.PI / 1.8; ring2.rotation.y = 0.7;
  nucleus.add(ring1, ring2);

  const nucleusHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(), color: 0x37c9e8, transparent: true, opacity: 0.30,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  nucleusHalo.scale.setScalar(34);
  nucleus.add(nucleusHalo);
  scene.add(nucleus);

  // ---------- tendrils: nucleus -> each biome, lit by traffic ----------
  const tendrils = {};
  for (const s of SECTORS) {
    const end = sectorCenter(s);
    end.y = heightAt(end.x, end.z) + 0.6;
    const mid = end.clone().multiplyScalar(0.45); mid.y = 9;
    const curve = new THREE.CatmullRomCurve3([NUCLEUS_POS.clone(), mid, end]);
    const geo = new THREE.TubeGeometry(curve, 48, 0.30, 7, false);
    const mat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uFlow: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform float uTime, uFlow;
        void main(){
          float base = 0.05;
          float band = smoothstep(0.12, 0.0, abs(fract(vUv.x * 2.0 - uTime * 0.9) - 0.5) - 0.06);
          vec3 col = vec3(0.25, 0.85, 0.95) * (base + band * uFlow * 0.9);
          gl_FragColor = vec4(col, base + band * min(uFlow, 1.5));
        }`,
    });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    tendrils[s.id] = mat;
  }

  // ---------- the Vault: RDB archive obelisk ----------
  const vaultGroup = new THREE.Group();
  const vy = heightAt(VAULT.x, VAULT.z);
  vaultGroup.position.set(VAULT.x, vy, VAULT.z);
  const obsidian = new THREE.MeshStandardMaterial({ color: 0x0a0c16, roughness: 0.25, metalness: 0.9, emissive: 0x1a0b33, emissiveIntensity: 0.6 });
  const obelisk = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 3.8, 30, 4), obsidian);
  obelisk.position.y = 15; obelisk.rotation.y = Math.PI / 4;
  vaultGroup.add(obelisk);
  const seamMat = new THREE.MeshBasicMaterial({ color: 0xb07aff });
  const seam = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 6, 40), seamMat);
  seam.rotation.x = Math.PI / 2; seam.position.y = 26;
  vaultGroup.add(seam);
  for (let i = 0; i < 7; i++) { // orbiting shards
    const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.7), obsidian.clone());
    shard.userData.orbit = { r: 6 + Math.random() * 3, a: Math.random() * Math.PI * 2, sp: 0.2 + Math.random() * 0.3, y: 8 + Math.random() * 14 };
    vaultGroup.add(shard);
  }
  scene.add(vaultGroup);
  let vaultGlow = 0;

  // ---------- the Reef: every connected client is an anemone ----------
  const reefGroup = new THREE.Group();
  scene.add(reefGroup);
  const anemones = new Map(); // source -> { group, bulbMat, flash, slot }
  const stalkGeo = new THREE.ConeGeometry(0.5, 4.5, 6);
  const bulbGeo = new THREE.SphereGeometry(0.62, 16, 12);
  let reefSlots = 0;

  function reefPoint(source) {
    let a = anemones.get(source);
    if (!a) {
      if (anemones.size >= 14) { // evict the quietest
        let worst = null, worstT = Infinity;
        for (const [k, v] of anemones) if (v.last < worstT) { worstT = v.last; worst = k; }
        const old = anemones.get(worst);
        reefGroup.remove(old.group);
        anemones.delete(worst);
        a = makeAnemone(source, old.slot);
      } else {
        a = makeAnemone(source, reefSlots++);
      }
      anemones.set(source, a);
    }
    a.flash = Math.min(a.flash + 0.8, 2.2);
    a.last = performance.now();
    const p = new THREE.Vector3();
    a.group.children[1].getWorldPosition(p);
    return p;
  }

  function makeAnemone(source, slot) {
    const g = new THREE.Group();
    const order = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7];
    const ang = REEF.angle + (order[slot % order.length]) * 0.085;
    const r = REEF.radius + ((slot * 37) % 3) * 6;
    g.position.set(Math.cos(ang) * r, heightAt(Math.cos(ang) * r, Math.sin(ang) * r), Math.sin(ang) * r);
    const stalk = new THREE.Mesh(stalkGeo, new THREE.MeshStandardMaterial({ color: 0x123040, roughness: 0.7, emissive: 0x0a3a4a, emissiveIntensity: 0.5 }));
    stalk.position.y = 2.2;
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0x9ff0ff });
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.y = 5.0;
    g.add(stalk, bulb);
    reefGroup.add(g);
    return { group: g, bulbMat, flash: 0, last: performance.now(), slot };
  }

  // ---------- ambient drifting spores ----------
  const N_SPORES = 900;
  const sporePos = new Float32Array(N_SPORES * 3);
  const sporeSeed = new Float32Array(N_SPORES);
  for (let i = 0; i < N_SPORES; i++) {
    const r = Math.sqrt(Math.random()) * 250, a = Math.random() * Math.PI * 2;
    sporePos[i * 3] = Math.cos(a) * r;
    sporePos[i * 3 + 1] = 1 + Math.random() * 55;
    sporePos[i * 3 + 2] = Math.sin(a) * r;
    sporeSeed[i] = Math.random() * 100;
  }
  const sporeGeo = new THREE.BufferGeometry();
  sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePos, 3));
  sporeGeo.setAttribute('seed', new THREE.BufferAttribute(sporeSeed, 1));
  const sporeMat = new THREE.ShaderMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float seed;
      uniform float uTime;
      varying float vA;
      void main(){
        vec3 p = position;
        p.x += sin(uTime * 0.12 + seed) * 4.0;
        p.y += sin(uTime * 0.07 + seed * 1.7) * 3.0;
        p.z += cos(uTime * 0.10 + seed * 0.9) * 4.0;
        vA = 0.25 + 0.55 * (0.5 + 0.5 * sin(uTime * 0.6 + seed * 3.0));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = min((1.6 + fract(seed) * 2.2) * (160.0 / -mv.z), 40.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d) * vA;
        gl_FragColor = vec4(vec3(0.35, 0.8, 0.85) * a, a);
      }`,
  });
  scene.add(new THREE.Points(sporeGeo, sporeMat));

  // ---------- live state ----------
  let beat = 0, ops = 0;

  const world = {
    scene, camera, renderer, composer, heightAt,
    nucleusBeat(amt = 0.35) { beat = Math.min(beat + amt, 1.6); },
    tendrilFlow(sectorId, amt = 0.6) {
      const m = tendrils[sectorId];
      if (m) m.uniforms.uFlow.value = Math.min(m.uniforms.uFlow.value + amt, 2.5);
    },
    reefPoint,
    setOps(n) { ops = n; },
    setMemory(bytes) {
      const f = Math.min(1, bytes / (48 * 1024 * 1024));
      moonMat.uniforms.uColor.value.setHSL(0.72 - f * 0.55, 0.8, 0.55);
      moonMat.uniforms.uGlow.value = 0.25 + f * 1.2;
      moonHalo.material.opacity = 0.18 + f * 0.5;
      moonHalo.scale.setScalar(140 + f * 160);
    },
    vaultFlash() { vaultGlow = 2.5; },
    nucleusPos: NUCLEUS_POS.clone(),
    vaultTop: new THREE.Vector3(VAULT.x, vy + 27, VAULT.z),

    update(dt, t) {
      terrainMat.uniforms.uTime.value = t;
      skyMat.uniforms.uTime.value = t;
      sporeMat.uniforms.uTime.value = t;
      coreMat.uniforms.uTime.value = t;

      beat = Math.max(0, beat - dt * 1.8);
      coreMat.uniforms.uBeat.value = beat;
      nucleusHalo.material.opacity = 0.24 + beat * 0.30 + 0.05 * Math.sin(t * 2.1);

      const spin = 0.25 + Math.min(ops, 120) * 0.012;
      ring1.rotation.z += dt * spin; ring2.rotation.z -= dt * spin * 0.8;
      nucleus.position.y = NUCLEUS_POS.y + Math.sin(t * 0.6) * 0.8;

      for (const m of Object.values(tendrils)) {
        m.uniforms.uTime.value = t;
        m.uniforms.uFlow.value = Math.max(0, m.uniforms.uFlow.value - dt * 1.4);
      }

      vaultGlow = Math.max(0, vaultGlow - dt * 1.2);
      seamMat.color.setHSL(0.75, 0.9, 0.5 + Math.min(vaultGlow, 1) * 0.5);
      seam.scale.setScalar(1 + vaultGlow * 0.4);
      for (const ch of vaultGroup.children) {
        const o = ch.userData.orbit;
        if (!o) continue;
        o.a += dt * o.sp * (1 + vaultGlow);
        ch.position.set(Math.cos(o.a) * o.r, o.y + Math.sin(t + o.r) * 0.8, Math.sin(o.a) * o.r);
        ch.rotation.x += dt; ch.rotation.y += dt * 0.7;
      }

      for (const a of anemones.values()) {
        a.flash = Math.max(0, a.flash - dt * 1.6);
        const f = 0.22 + a.flash * 0.75;
        a.bulbMat.color.setRGB(0.35 * f, 0.85 * f, 1.0 * f);
        a.group.children[1].position.y = 5.0 + Math.sin(t * 1.3 + a.slot) * 0.25;
      }
    },
  };
  return world;
}
