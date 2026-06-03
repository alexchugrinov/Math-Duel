const TrainingScreen = (() => {
  let timer = null;
  let sessionId = null;
  let currentQuestionId = null;
  let difficulty = 'medium';

  function init(container) {
    renderSetup(container);
  }

  function renderSetup(container) {
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <h2>Training Mode</h2>
          <p class="subtitle">10 questions — go at your own pace</p>
          <p style="font-size:0.9rem;color:var(--text-muted);margin-bottom:12px">Select difficulty:</p>
          <div class="difficulty-group">
            <button class="diff-btn" data-d="easy">Easy</button>
            <button class="diff-btn active" data-d="medium">Medium</button>
            <button class="diff-btn" data-d="hard">Hard</button>
          </div>
          <button class="btn btn-primary" id="btn-start">Start Training</button>
          <button class="btn btn-ghost mt8" id="btn-back">← Back</button>
        </div>
      </div>
    `;

    container.querySelectorAll('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        difficulty = btn.dataset.d;
      });
    });
    container.querySelector('#btn-start').addEventListener('click', () => startGame(container));
    container.querySelector('#btn-back').addEventListener('click', () => App.navigate('home'));
  }

  function startGame(container) {
    if (!Socket.isOpen()) {
      alert('Not connected to server. Please wait a moment and try again.');
      return;
    }
    renderGame(container);
    Socket.on('question', handleQuestion);
    Socket.on('answer_result', handleAnswerResult);
    Socket.on('question_timeout', handleTimeout);
    Socket.on('game_over', handleGameOver);
    Socket.send({ type: 'training_start', difficulty });
  }

  function renderGame(container) {
    container.innerHTML = `
      <div class="screen">
        <div class="card">
          <div class="game-header">
            <span class="q-counter" id="q-counter">Question 1/10</span>
            <span class="score-display" id="score-display">Score: 0</span>
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

    timer = UI.makeTimerBar(container.querySelector('#timer-bar-container'));

    const input = container.querySelector('#answer-input');
    container.querySelector('#btn-submit').addEventListener('click', () => submitAnswer(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submitAnswer(input.value); });
  }

  function handleQuestion(msg) {
    if (!document.getElementById('q-text')) return;
    sessionId = msg.sessionId;
    currentQuestionId = msg.questionId;
    document.getElementById('q-text').textContent = msg.text;
    document.getElementById('q-counter').textContent = `Question ${msg.number}/${msg.total}`;
    document.getElementById('feedback').textContent = '';
    document.getElementById('feedback').className = 'feedback';
    const input = document.getElementById('answer-input');
    if (input) { input.value = ''; input.focus(); input.disabled = false; }
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

  function handleAnswerResult(msg) {
    if (timer) timer.stop();
    disableInput();
    const fb = document.getElementById('feedback');
    const scoreEl = document.getElementById('score-display');
    if (!fb) return;
    if (msg.correct) {
      fb.textContent = `✓ Correct! +${msg.pointsEarned} pts`;
      fb.className = 'feedback correct';
    } else {
      fb.textContent = `✗ Wrong — answer was ${msg.correctAnswer}`;
      fb.className = 'feedback wrong';
    }
    if (scoreEl) scoreEl.textContent = `Score: ${msg.totalScore}`;
  }

  function handleTimeout(msg) {
    if (timer) timer.stop();
    disableInput();
    const fb = document.getElementById('feedback');
    if (fb) {
      fb.textContent = `⏱ Time's up — answer was ${msg.correctAnswer}`;
      fb.className = 'feedback wrong';
    }
  }

  function handleGameOver(msg) {
    if (timer) timer.stop();
    if (msg.updatedUser) App.refreshUser(msg.updatedUser);
    UI.showGameOver({
      mode: 'training',
      yourScore: msg.yourScore,
      opponentScore: null,
      result: null,
      newBest: msg.newBest,
      breakdown: msg.breakdown,
      onPlayAgain: () => { cleanupListeners(); App.navigate('train'); },
      onHome: () => { cleanupListeners(); App.navigate('home'); },
    });
  }

  function cleanupListeners() {
    Socket.off('question');
    Socket.off('answer_result');
    Socket.off('question_timeout');
    Socket.off('game_over');
  }

  function destroy() {
    cleanupListeners();
    if (timer) timer.stop();
    sessionId = null;
    currentQuestionId = null;
  }

  return { init, destroy };
})();
