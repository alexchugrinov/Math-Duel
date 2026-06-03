const API = (() => {
  const BASE = '/api';

  async function request(method, path, body, token) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(BASE + path, opts);
    const data = await res.json();
    if (!res.ok) throw data;
    return data;
  }

  return {
    register: (username, password) => request('POST', '/register', { username, password }),
    login: (username, password) => request('POST', '/login', { username, password }),
    leaderboard: (mode = 'pvp') => request('GET', `/leaderboard?mode=${mode}`),
    me: (token) => request('GET', '/me', null, token),
    history: (token, limit = 10) => request('GET', `/history?limit=${limit}`, null, token),
  };
})();
