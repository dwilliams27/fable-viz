#!/usr/bin/env node
// start.mjs — boots the whole organism: redis-server, the bridge, and vite.
// Ctrl-C tears everything down.

import { spawn } from 'node:child_process';

const procs = [];

function run(name, cmd, args, color) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  const pipe = (s) => s.on('data', (d) => d.toString().split('\n').filter(Boolean).forEach(l => console.log(`${tag} ${l}`)));
  pipe(p.stdout); pipe(p.stderr);
  p.on('exit', (code) => {
    console.log(`${tag} exited (${code})`);
    if (!shuttingDown) shutdown(1);
  });
  procs.push(p);
  return p;
}

let shuttingDown = false;
function shutdown(code = 0) {
  shuttingDown = true;
  for (const p of procs) { try { p.kill('SIGTERM'); } catch { } }
  setTimeout(() => process.exit(code), 400);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

run('redis', 'redis-server', ['--port', '6390', '--save', '', '--appendonly', 'no', '--notify-keyspace-events', 'Exe'], '31');
setTimeout(() => run('bridge', 'node', ['server/bridge.mjs'], '35'), 800);
setTimeout(() => run('vite', 'npx', ['vite', '--port', '5173', '--strictPort', '--open'], '36'), 1200);

console.log('\x1b[1m  NECTARWORLD — http://localhost:5173  (Ctrl-C to stop)\x1b[0m');
