const LeaderboardScreen = (() => {
  let activeMode = 'pvp';

  function init(container, state) {
    container.innerHTML = `
      <div class="screen wide">
        <div class="card">
          <h2>Leaderboard</h2>
          <div class="tabs" style="margin-bottom:16px">
            <button class="tab-btn active" id="tab-pvp">PVP</button>
            <button class="tab-btn" id="tab-train">Training</button>
          </div>
          <div id="lb-content">
            <p class="text-muted text-center">Loading…</p>
          </div>
          <button class="btn btn-ghost mt16" id="btn-back">← Back</button>
        </div>
      </div>
    `;

    container.querySelector('#tab-pvp').addEventListener('click', () => switchMode('pvp', container, state));
    container.querySelector('#tab-train').addEventListener('click', () => switchMode('training', container, state));
    container.querySelector('#btn-back').addEventListener('click', () => App.navigate('home'));

    loadLeaderboard('pvp', container, state);
  }

  function switchMode(mode, container, state) {
    activeMode = mode;
    container.querySelector('#tab-pvp').classList.toggle('active', mode === 'pvp');
    container.querySelector('#tab-train').classList.toggle('active', mode === 'training');
    loadLeaderboard(mode, container, state);
  }

  async function loadLeaderboard(mode, container, state) {
    const lbContent = container.querySelector('#lb-content');
    lbContent.innerHTML = '<p class="text-muted text-center">Loading…</p>';

    try {
      const data = await API.leaderboard(mode);
      const myUsername = state.user?.username;

      if (!data.entries || data.entries.length === 0) {
        lbContent.innerHTML = '<p class="text-muted text-center">No games played yet. Be the first!</p>';
        return;
      }

      const rows = data.entries.map(entry => {
        const isMe = entry.username === myUsername;
        const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : '';
        return `
          <tr class="${isMe ? 'highlight' : ''}">
            <td class="rank">${medal || entry.rank}</td>
            <td>${entry.username}${isMe ? ' (you)' : ''}</td>
            <td style="text-align:right;font-weight:700">${entry.best_score}</td>
          </tr>
        `;
      }).join('');

      lbContent.innerHTML = `
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th style="text-align:right">Best Score</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    } catch {
      lbContent.innerHTML = '<p class="text-muted text-center">Failed to load leaderboard.</p>';
    }
  }

  function destroy() {}

  return { init, destroy };
})();
