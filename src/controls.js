// controls.js — first-person walking (terrain-following) with a fly toggle.
// Manual pointer-lock look so we own the feel. ?demo=1 = slow auto-orbit for screenshots.

import * as THREE from 'three';
import { heightAt } from './world.js';

export function createControls(camera, dom) {
  const demo = new URLSearchParams(location.search).has('demo');
  let yaw = 0, pitch = -0.05;
  let fly = false;
  const keys = new Set();
  const pos = new THREE.Vector3(118, 0, 24);
  pos.y = heightAt(pos.x, pos.z) + 1.8;
  yaw = Math.atan2(pos.x, pos.z) + Math.PI; // face the nucleus... fixed below
  let locked = false;

  // face origin
  yaw = Math.atan2(-pos.x, -pos.z);

  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyF') fly = !fly;
  });
  addEventListener('keyup', (e) => keys.delete(e.code));

  dom.addEventListener('click', () => { if (!demo && !locked) dom.requestPointerLock(); });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === dom; });
  document.addEventListener('mousemove', (e) => {
    if (!locked) return;
    yaw -= e.movementX * 0.0021;
    pitch -= e.movementY * 0.0021;
    pitch = Math.max(-1.45, Math.min(1.45, pitch));
  });

  let demoT = 0;

  function update(dt, t) {
    if (demo) {
      demoT += dt;
      const a = demoT * 0.05 + 0.6;
      const r = 120 + Math.sin(demoT * 0.11) * 35;
      camera.position.set(Math.cos(a) * r, 26 + Math.sin(demoT * 0.07) * 14, Math.sin(a) * r);
      camera.lookAt(0, 12, 0);
      return;
    }

    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = (fly ? 30 : 13) * (sprint ? 2.3 : 1);
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = new THREE.Vector3();
    if (keys.has('KeyW')) move.add(fwd);
    if (keys.has('KeyS')) move.sub(fwd);
    if (keys.has('KeyD')) move.add(right);
    if (keys.has('KeyA')) move.sub(right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);
    pos.add(move);

    if (fly) {
      if (keys.has('Space')) pos.y += speed * dt * 0.8;
      if (keys.has('KeyC')) pos.y -= speed * dt * 0.8;
      pos.y = Math.max(pos.y, heightAt(pos.x, pos.z) + 1.2);
      pos.y = Math.min(pos.y, 220);
    } else {
      const ground = heightAt(pos.x, pos.z) + 1.8;
      pos.y += (ground - pos.y) * Math.min(1, dt * 10);
    }

    // stay on the planet
    const r = Math.hypot(pos.x, pos.z);
    if (r > 240) { pos.x *= 240 / r; pos.z *= 240 / r; }
    // don't walk through the nucleus column
    if (!fly && r < 13) { pos.x *= 13 / Math.max(r, 0.01); pos.z *= 13 / Math.max(r, 0.01); }

    camera.position.copy(pos);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  return {
    update,
    isDemo: demo,
    isLocked: () => locked || demo,
    getPos: () => pos,
    teleport(x, y, z, lookYaw = yaw, lookPitch = pitch) { pos.set(x, y, z); yaw = lookYaw; pitch = lookPitch; },
  };
}
