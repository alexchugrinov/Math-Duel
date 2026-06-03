const App = (() => {
  let currentScreen = null;
  let state = {
    user: null,
    token: null,
  };

  const screens = {
    login: LoginScreen,
    home: HomeScreen,
    train: TrainingScreen,
    pvp: PvpScreen,
    leaderboard: LeaderboardScreen,
  };

  function getHash() {
    return window.location.hash.slice(1) || 'login';
  }

  function navigate(hash) {
    window.location.hash = hash;
  }

  function render() {
    const hash = getHash();
    const needsAuth = hash !== 'login';

    if (needsAuth && !state.token) {
      navigate('login');
      return;
    }
    if (hash === 'login' && state.token) {
      navigate('home');
      return;
    }

    const ScreenModule = screens[hash] || screens.home;

    if (currentScreen && currentScreen.destroy) currentScreen.destroy();

    const app = document.getElementById('app');
    app.innerHTML = '';
    currentScreen = ScreenModule;
    ScreenModule.init(app, state);

    const topbar = document.getElementById('topbar');
    if (state.token) {
      topbar.classList.remove('hidden');
      updateTopbar();
    } else {
      topbar.classList.add('hidden');
    }
  }

  function updateTopbar() {
    if (!state.user) return;
    document.getElementById('topbar-username').textContent = state.user.username;
    document.getElementById('topbar-pvp-score').textContent = `PVP ${state.user.best_score_pvp || 0}`;
    document.getElementById('topbar-train-score').textContent = `Train ${state.user.best_score_training || 0}`;
  }

  function setUser(user, token) {
    state.user = user;
    state.token = token;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    updateTopbar();
  }

  function refreshUser(user) {
    state.user = { ...state.user, ...user };
    localStorage.setItem('user', JSON.stringify(state.user));
    updateTopbar();
  }

  function logout() {
    state.user = null;
    state.token = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    Socket.disconnect();
    navigate('login');
  }

  function init() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    if (token && user) {
      state.token = token;
      state.user = JSON.parse(user);
    }

    window.addEventListener('hashchange', render);

    document.getElementById('btn-logout').addEventListener('click', logout);

    render();

    if (state.token) {
      Socket.connect(state.token);
    }
  }

  return { init, navigate, setUser, refreshUser, logout, getState: () => state, updateTopbar };
})();

document.addEventListener('DOMContentLoaded', App.init);
