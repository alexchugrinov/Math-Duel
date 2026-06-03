const PvpScreen = (() => {
  let sessionId = null;
  let currentQuestionId = null;
  let countdownInterval = null;
  let timer = null;
  let cont = null;
  let opponentName = null;
  let myScore = 0;
  let oppScore = 0;

  function init(container) {
    cont = container;
    reset();
    renderMatchmaking();
  }

  function reset() {
    sessionId = null;
    currentQuestionId = null;
    opponentName = null;
    myScore = 0;
    oppScore = 0;
    clearInterval(countdownInterval);
    countdownInterval = null;
    if (timer) { timer.stop(); timer = null; }
  }

  function renderMatchmaking() {
    cont.innerHTML = `
      <div class="screen">
        <div class="card">
          <h2>PVP Match</h2>
          <p class="subtitle">Find an opponent and battle it out!</p>
          <div class="waiting-box">
            <div class="spinner"></div>
            <p id="queue-status">Finding an opponent…</p>
            <button class="btn btn-ghost" id="btn-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    cont.querySelector('#btn-cancel').addEventListener('click', cancelQueue);

    Socket.on('queue_status', onQueueStatus);
    Socket.on('match_found', onMatchFound);
    Socket.on('question', onQuestion);
    Socket.on('answer_result', onAnswerResult);
    Socket.on('question_timeout', onTimeout);
    Socket.on('game_over', onGameOver);
    Socket.on('opponent_disconnected', onOpponentDisconnected);

    if (Socket.isOpen()) {
      Socket.send({ type: 'queue_join' });
    } else {
      document.getElementById('queue-status').textContent = 'Connecting…';
      Socket.on('auth_ok', () => {
        Socket.off('auth_ok');
        Socket.send({ type: 'queue_join' });
        const el = document.getElementById('queue-status');
        if (el) el.textContent = 'Finding an opponent…';
      });
    }
  }

  function cancelQueue() {
    Socket.send({ type: 'queue_leave' });
    cleanupListeners();
    App.navigate('home');
  }

  function onQueueStatus(msg) {
    const el = document.getElementById('queue-status');
    if (el) el.textContent = `In queue (position ${msg.position}) — waiting for opponent…`;
  }

  function onMatchFound(msg) {
    sessionId = msg.sessionId;
    opponentName = msg.opponent.username;
    renderCountdown(msg.opponent, msg.startsInMs);
  }

  function renderCountdown(opponent, startsInMs) {
    cont.innerHTML = `
      <div class="screen">
        <div class="card text-center">
          <p class="text-muted" style="margin-bottom:8px">VS</p>
          <h2>${opponent.username}</h2>
          <p class="text-muted" style="font-size:0.85rem;margin-bottom:24px">Best PVP: ${opponent.bestScorePvp || 0}</p>
          <div class="countdown-box">
            <div class="big-num" id="countdown-num">3</div>
            <p>Get ready!</p>
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

  function onQuestion(msg) {
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

  function onAnswerResult(msg) {
    if (timer) timer.stop();
    disableInput();
    myScore = msg.totalScore;
    const myEl = document.getElementById('my-score');
    if (myEl) myEl.textContent = myScore;
    if (msg.opponentScore !== undefined) {
      const oppEl = document.getElementById('opp-score');
      if (oppEl) oppEl.textContent = msg.opponentScore;
    }
    const fb = document.getElementById('feedback');
    if (!fb) return;
    if (msg.correct) {
      fb.textContent = `✓ Correct! +${msg.pointsEarned} pts`;
      fb.className = 'feedback correct';
    } else {
      fb.textContent = `✗ Wrong — answer was ${msg.correctAnswer}`;
      fb.className = 'feedback wrong';
    }
  }

  function onTimeout(msg) {
    if (timer) timer.stop();
    disableInput();
    const fb = document.getElementById('feedback');
    if (fb) {
      fb.textContent = `⏱ Time's up — answer was ${msg.correctAnswer}`;
      fb.className = 'feedback wrong';
    }
  }

  function onOpponentDisconnected() {
    const fb = document.getElementById('feedback');
    if (fb) {
      fb.textContent = '⚠ Opponent disconnected — waiting 10s…';
      fb.className = 'feedback';
    }
  }

  function onGameOver(msg) {
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
  }

  function cleanupListeners() {
    ['queue_status','match_found','question','answer_result','question_timeout','game_over','opponent_disconnected','auth_ok'].forEach(t => Socket.off(t));
  }

  function destroy() {
    cleanupListeners();
    reset();
    cont = null;
  }

  return { init, destroy };
})();
