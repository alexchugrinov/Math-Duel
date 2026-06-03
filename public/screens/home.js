const HomeScreen = (() => {
  function init(container, state) {
    const user = state.user || {};
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <h1>Welcome, ${user.username || ''}!</h1>
          <p class="subtitle">Ready to test your math skills?</p>
          <div class="home-scores">
            <div class="home-score-card">
              <div class="label">Best PVP Score</div>
              <div class="value">${user.best_score_pvp || 0}</div>
            </div>
            <div class="home-score-card">
              <div class="label">Best Training Score</div>
              <div class="value">${user.best_score_training || 0}</div>
            </div>
          </div>
          <div class="menu-btn-group">
            <button class="btn btn-primary menu-btn" id="btn-training">
              <span class="icon">📚</span>
              <span>Training Mode</span>
              <span class="desc">Solo practice</span>
            </button>
            <button class="btn btn-secondary menu-btn" id="btn-pvp">
              <span class="icon">⚔️</span>
              <span>PVP Match</span>
              <span class="desc">Challenge a player</span>
            </button>
            <button class="btn btn-outline menu-btn" id="btn-lb">
              <span class="icon">🏆</span>
              <span>Leaderboard</span>
              <span class="desc">See top players</span>
            </button>
          </div>
        </div>
      </div>
    `;

    container.querySelector('#btn-training').addEventListener('click', () => App.navigate('train'));
    container.querySelector('#btn-pvp').addEventListener('click', () => App.navigate('pvp'));
    container.querySelector('#btn-lb').addEventListener('click', () => App.navigate('leaderboard'));

    // Refresh user data from server to keep scores current
    const { token } = App.getState();
    if (token) {
      API.me(token).then(data => {
        App.refreshUser(data.user);
        const pvpEl = container.querySelector('.home-scores .home-score-card:first-child .value');
        const trainEl = container.querySelector('.home-scores .home-score-card:last-child .value');
        if (pvpEl) pvpEl.textContent = data.user.best_score_pvp || 0;
        if (trainEl) trainEl.textContent = data.user.best_score_training || 0;
      }).catch(() => {});
    }
  }

  function destroy() {}

  return { init, destroy };
})();
