const Socket = (() => {
  let ws = null;
  const handlers = {};

  function on(type, fn) {
    handlers[type] = fn;
  }

  function off(type) {
    delete handlers[type];
  }

  function dispatch(msg) {
    const fn = handlers[msg.type] || handlers['*'];
    if (fn) fn(msg);
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  function connect(token) {
    if (ws && ws.readyState <= 1) return;

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    setWsDot('connecting');

    ws.onopen = () => {
      setWsDot('connecting');
      send({ type: 'auth', token });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_ok') setWsDot('connected');
        dispatch(msg);
      } catch {}
    };

    ws.onclose = () => {
      setWsDot('disconnected');
      dispatch({ type: 'ws_closed' });
      ws = null;
      // Auto-reconnect after 3s if we have a token
      const { token: t } = App.getState();
      if (t) setTimeout(() => connect(t), 3000);
    };

    ws.onerror = () => {};
  }

  function disconnect() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    setWsDot('disconnected');
  }

  function setWsDot(state) {
    const dot = document.getElementById('ws-status');
    if (!dot) return;
    dot.className = `ws-dot ${state}`;
    dot.title = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting…' : 'Disconnected';
  }

  function isOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  return { on, off, send, connect, disconnect, isOpen };
})();
