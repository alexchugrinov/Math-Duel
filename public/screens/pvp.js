const PvpScreen = (() => {
  let cont = null;
  let sessionId = null;
  let currentQuestionId = null;
  let countdownInterval = null;
  let timer = null;
  let opponentName = null;

  function init(container, state) {
    cont = container;
    reset();
    // Bootstrap with cached list, then request a fresh one from server
    renderLobby(state._onlineUsers || []);
    registerListeners();
    Socket.send({ type: 'request_online_users' });
  }

  function reset() {
    sessionId = null;
    currentQuestionId = null;
    opponentName = null;
    clearInterval(countdownInterval);
    countdownInterval = null;
    if (timer) { timer.stop(); timer = null; }
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────

  function renderLobby(onlineUsers) {
    const users = onlineUsers || [];
    cont.innerHTML = `
      <div class="screen">
        <div class="card">
          <h2>PVP Match</h2>
          <p class="subtitle">Challenge a player or find a random opponent</p>

          <div class="online-section">
            <p class="section-label">Online now <span class="online-count">${users.length}</span></p>
            <div id="players-list">
              ${users.length === 0
                ? '<p class="no-players">No other players online right now.</p>'
                : users.map(u => `
                    <div class="player-row" data-uid="${u.userId}">
                      <span class="player-name">${u.username}</span>
                      <button class="btn btn-sm btn-primary challenge-btn" data-uid="${u.userId}" data-uname="${u.username}">Challenge</button>
                    </div>`).join('')}
            </div>
          </div>

          <hr class="divider">
          <button class="btn btn-secondary" id="btn-quick-match">⚡ Quick Match (random)</button>
          <button class="btn btn-ghost mt8" id="btn-back">← Back</button>
        </div>
      </div>
    `;

    cont.querySelectorAll('.challenge-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid = parseInt(btn.dataset.uid);
        const uname = btn.dataset.uname;
        sendChallenge(uid, uname);
      });
    });
    cont.querySelector('#btn-quick-match').addEventListener('click', joinQueue);
    cont.querySelector('#btn-back').addEventListener('click', () => { cleanupListeners(); App.navigate('home'); });
  }

  function updateLobbyPlayers(users) {
    const list = document.getElementById('players-list');
    if (!list) return;
    if (users.length === 0) {
      list.innerHTML = '<p class="no-players">No other players online right now.</p>';
      const countEl = cont.querySelector('.online-count');
      if (countEl) countEl.textContent = 0;
      return;
    }
    list.innerHTML = users.map(u => `
      <div class="player-row" data-uid="${u.userId}">
        <span class="player-name">${u.username}</span>
        <button class="btn btn-sm btn-primary challenge-btn" data-uid="${u.userId}" data-uname="${u.username}">Challenge</button>
      </div>`).join('');
    list.querySelectorAll('.challenge-btn').forEach(btn => {
      btn.addEventListener('click', () => sendChallenge(parseInt(btn.dataset.uid), btn.dataset.uname));
    });
    const countEl = cont.querySelector('.online-count');
    if (countEl) countEl.textContent = users.length;
  }

  // ── Challenge flow ─────────────────────────────────────────────────────────

  function sendChallenge(targetUserId, targetUsername) {
    Socket.send({ type: 'challenge_user', targetUserId });
    renderChallengeSent(targetUsername, targetUserId);
  }

  function renderChallengeSent(targetUsername, targetUserId) {
    cont.innerHTML = `
      <div class="screen">
        <div class="card text-center">
          <h2>Challenging…</h2>
          <p class="subtitle" style="margin-bottom:24px">Waiting for <strong>${targetUsername}</strong> to accept</p>
          <div class="spinner" style="margin:0 auto 20px"></div>
          <button class="btn btn-ghost" id="btn-cancel-challenge">Cancel</button>
        </div>
      </div>
    `;
    cont.querySelector('#btn-cancel-challenge').addEventListener('click', () => {
      Socket.send({ type: 'cancel_challenge', targetUserId });
      renderLobby();
    });
  }

  function showIncomingChallenge(fromUserId, fromUsername) {
    // Show as overlay on top of whatever screen is shown
    const existing = document.getElementById('challenge-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'challenge-overlay';
    overlay.className = 'challenge-overlay';
    overlay.innerHTML = `
      <div class="challenge-popup">
        <p class="challenge-from">⚔️ <strong>${fromUsername}</strong> challenges you!</p>
        <div class="btn-row mt16">
          <button class="btn btn-primary" id="btn-accept">Accept</button>
          <button class="btn btn-ghost" id="btn-decline">Decline</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#btn-accept').addEventListener('click', () => {
      overlay.remove();
      Socket.send({ type: 'accept_challenge', fromUserId });
    });
    overlay.querySelector('#btn-decline').addEventListener('click', () => {
      overlay.remove();
      Socket.send({ type: 'decline_challenge', fromUserId });
    });
  }

  // ── Quick Match queue ──────────────────────────────────────────────────────

  function joinQueue() {
    Socket.send({ type: 'queue_join' });
    cont.innerHTML = `
      <div class="screen">
        <div class="card">
          <h2>Quick Match</h2>
          <div class="waiting-box">
            <div class="spinner"></div>
            <p id="queue-status">Finding a random opponent…</p>
            <button class="btn btn-ghost" id="btn-cancel-queue">Cancel</button>
          </div>
        </div>
      </div>
    `;
    cont.querySelector('#btn-cancel-queue').addEventListener('click', () => {
      Socket.send({ type: 'queue_leave' });
      renderLobby();
    });
  }

  // ── Countdown ──────────────────────────────────────────────────────────────

  function renderCountdown(opponent, startsInMs) {
    cont.innerHTML = `
      <div class="screen">
        <div class="card text-center">
          <p class="text-muted" style="margin-bottom:8px">VS</p>
          <h2>${opponent.username}</h2>
          <p class="text-muted" style="font-size:0.85rem;margin-bottom:24px">Best PVP: ${opponent.bestScorePvp || 0}</p>
          <div class="countdown-box">
            <div class="big-num" id="countdown-num">3</div>
            <p>Answer as fast as you can!</p>
          </div>
        </div>
      </div>
    `;
    let remaining = Math.ceil(startsInMs / 1000);
    countdownInterval = setInterval(() => {
      remaining--;
      const el = document.getElementById('countdown-num');
      if (el) el.textContent = remaining > 0 ? remaining : 'GO!';
      if (remaining <= 0) { clearInterval(countdownInterval); countdownInterval = null; }
    }, 1000);
  }

  // ── In-game ────────────────────────────────────────────────────────────────

  function renderGameUI() {
    const myName = App.getState().user?.username || 'You';
    cont.innerHTML = `
      <div class="screen">
        <div class="card">
          <div class="game-header">
            <span class="q-counter" id="q-counter">Question 1/10</span>
            <div class="vs-score">
              <div class="player-score you">
                <div class="name">${myName}</div>
                <div class="pts" id="my-score">0</div>
              </div>
              <span class="sep">vs</span>
              <div class="player-score opp">
                <div class="name">${opponentName || 'Opponent'}</div>
                <div class="pts" id="opp-score">0</div>
              </div>
            </div>
          </div>
          <div id="timer-bar-container"></div>
          <div class="question-box">
            <div class="question-text" id="q-text">…</div>
          </div>
          <div class="answer-row">
            <input id="answer-input" type="number" placeholder="Your answer" autofocus>
            <button class="btn btn-primary" id="btn-submit" style="width:auto;padding:14px 20px">Submit</button>
          </div>
          <div class="feedback" id="feedback"></div>
        </div>
      </div>
    `;
    timer = UI.makeTimerBar(cont.querySelector('#timer-bar-container'));
    const input = cont.querySelector('#answer-input');
    cont.querySelector('#btn-submit').addEventListener('click', () => submitAnswer(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(input.value); });
  }

  function submitAnswer(value) {
    if (!sessionId || !currentQuestionId) return;
    const answer = parseFloat(value);
    if (isNaN(answer)) return;
    disableInput();
    Socket.send({ type: 'answer_submit', sessionId, questionId: currentQuestionId, answer });
    currentQuestionId = null;
  }

  function disableInput() {
    const input = document.getElementById('answer-input');
    const btn = document.getElementById('btn-submit');
    if (input) input.disabled = true;
    if (btn) btn.disabled = true;
  }

  // ── WS event handlers ──────────────────────────────────────────────────────

  function registerListeners() {
    Socket.on('online_users', msg => {
      if (document.getElementById('players-list')) updateLobbyPlayers(msg.users);
    });

    Socket.on('queue_status', msg => {
      const el = document.getElementById('queue-status');
      if (el) el.textContent = `In queue (position ${msg.position})…`;
    });

    Socket.on('challenge_sent', msg => {
      // already rendered by sendChallenge()
    });

    Socket.on('challenge_received', msg => {
      showIncomingChallenge(msg.fromUserId, msg.fromUsername);
    });

    Socket.on('challenge_declined', msg => {
      document.getElementById('challenge-overlay')?.remove();
      renderLobby();
      UI.showModal(`
        <p style="text-align:center;font-size:1.1rem">❌ <strong>${msg.targetUsername}</strong> declined your challenge.</p>
        <button class="btn btn-primary mt16" id="modal-ok">OK</button>
      `);
      document.getElementById('modal-ok').addEventListener('click', UI.hideModal);
    });

    Socket.on('challenge_cancelled', msg => {
      document.getElementById('challenge-overlay')?.remove();
    });

    Socket.on('challenge_timeout', msg => {
      renderLobby();
      UI.showModal(`
        <p style="text-align:center;font-size:1.1rem">⏱ <strong>${msg.targetUsername}</strong> didn't respond in time.</p>
        <button class="btn btn-primary mt16" id="modal-ok">OK</button>
      `);
      document.getElementById('modal-ok').addEventListener('click', UI.hideModal);
    });

    Socket.on('challenge_error', msg => {
      renderLobby();
    });

    Socket.on('match_found', msg => {
      sessionId = msg.sessionId;
      opponentName = msg.opponent.username;
      document.getElementById('challenge-overlay')?.remove();
      renderCountdown(msg.opponent, msg.startsInMs);
    });

    Socket.on('question', msg => {
      if (!document.getElementById('q-text')) renderGameUI();
      clearInterval(countdownInterval);
      countdownInterval = null;
      sessionId = msg.sessionId;
      currentQuestionId = msg.questionId;
      document.getElementById('q-text').textContent = msg.text;
      document.getElementById('q-counter').textContent = `Question ${msg.number}/${msg.total}`;
      document.getElementById('feedback').textContent = '';
      document.getElementById('feedback').className = 'feedback';
      const input = document.getElementById('answer-input');
      if (input) { input.value = ''; input.disabled = false; input.focus(); }
      const btn = document.getElementById('btn-submit');
      if (btn) btn.disabled = false;
      if (timer) timer.start(msg.serverTimestamp, msg.timeLimitMs);
    });

    Socket.on('answer_result', msg => {
      if (timer) timer.stop();
      disableInput();
      const myEl = document.getElementById('my-score');
      if (myEl) myEl.textContent = msg.totalScore;
      if (msg.opponentScore !== undefined) {
        const oppEl = document.getElementById('opp-score');
        if (oppEl) oppEl.textContent = msg.opponentScore;
      }
      const fb = document.getElementById('feedback');
      if (!fb) return;
      fb.textContent = msg.correct ? `✓ Correct! +${msg.pointsEarned} pts` : `✗ Wrong — answer was ${msg.correctAnswer}`;
      fb.className = msg.correct ? 'feedback correct' : 'feedback wrong';
    });

    Socket.on('opponent_scored', msg => {
      const oppEl = document.getElementById('opp-score');
      if (oppEl) oppEl.textContent = msg.opponentScore;
    });

    Socket.on('question_timeout', msg => {
      if (timer) timer.stop();
      disableInput();
      const fb = document.getElementById('feedback');
      if (fb) { fb.textContent = `⏱ Time's up — answer was ${msg.correctAnswer}`; fb.className = 'feedback wrong'; }
    });

    Socket.on('waiting_for_opponent', () => {
      if (timer) timer.stop();
      cont.innerHTML = `
        <div class="screen">
          <div class="card text-center">
            <h2>You finished!</h2>
            <p class="subtitle">Waiting for ${opponentName || 'opponent'} to complete their questions…</p>
            <div class="spinner" style="margin:24px auto 0"></div>
          </div>
        </div>
      `;
    });

    Socket.on('opponent_disconnected', () => {
      const fb = document.getElementById('feedback');
      if (fb) { fb.textContent = '⚠ Opponent disconnected — waiting 10s…'; fb.className = 'feedback'; }
    });

    Socket.on('game_over', msg => {
      if (timer) timer.stop();
      clearInterval(countdownInterval);
      if (msg.updatedUser) App.refreshUser(msg.updatedUser);
      UI.showGameOver({
        mode: 'pvp',
        yourScore: msg.yourScore,
        opponentScore: msg.opponentScore,
        result: msg.result,
        newBest: msg.newBest,
        breakdown: msg.breakdown,
        onPlayAgain: null,
        onHome: () => { cleanupListeners(); App.navigate('home'); },
      });
    });
  }

  function cleanupListeners() {
    document.getElementById('challenge-overlay')?.remove();
    ['online_users','queue_status','challenge_sent','challenge_received','challenge_declined',
     'challenge_cancelled','challenge_timeout','challenge_error',
     'match_found','question','answer_result','opponent_scored',
     'question_timeout','waiting_for_opponent','opponent_disconnected','game_over','auth_ok'
    ].forEach(t => Socket.off(t));
  }

  function destroy() {
    cleanupListeners();
    reset();
    cont = null;
  }

  return { init, destroy };
})();
