// net.js — WebSocket client for the bridge. Reconnects forever; dispatches typed events.

const WS_URL = `ws://${location.hostname}:7080`;

export function connect(handlers) {
  let ws, alive = false;

  function open() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { alive = true; handlers.status?.('linked'); };
    ws.onclose = () => {
      if (alive) handlers.status?.('lost');
      alive = false;
      setTimeout(open, 1500);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'batch') { for (const ev of m.evs) route(ev); }
      else route(m);
    };
  }

  function route(m) {
    switch (m.t) {
      case 'snap': handlers.snapshot?.(m.keys); break;
      case 'sizes': handlers.sizes?.(m.keys); break;
      case 'cmd': handlers.command?.(m); break;
      case 'gone': handlers.gone?.(m.k, m.why); break;
      case 'info': handlers.info?.(m); break;
      case 'save': handlers.save?.(m.phase); break;
    }
  }

  open();
}
