const UI = (() => {
  function showModal(html) {
    const overlay = document.getElementById('modal-overlay');
    const box = document.getElementById('modal-box');
    box.innerHTML = html;
    overlay.classList.remove('hidden');
    return box;
  }

  function hideModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  function makeTimerBar(container) {
    const wrap = document.createElement('div');
    wrap.className = 'timer-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'timer-bar';
    wrap.appendChild(bar);
    container.appendChild(wrap);

    let rafId = null;
    let startTs = null;
    let limitMs = null;

    function tick() {
      const elapsed = Date.now() - startTs;
      const pct = Math.max(0, 1 - elapsed / limitMs);
      bar.style.width = (pct * 100) + '%';
      if (pct < 0.25) bar.className = 'timer-bar urgent';
      else if (pct < 0.5) bar.className = 'timer-bar warn';
      else bar.className = 'timer-bar';
      if (pct > 0) rafId = requestAnimationFrame(tick);
    }

    return {
      start(serverTimestamp, timeLimitMs) {
        cancelAnimationFrame(rafId);
        limitMs = timeLimitMs;
        startTs = Date.now() - (Date.now() - serverTimestamp);
        tick();
      },
      stop() { cancelAnimationFrame(rafId); bar.style.width = '0%'; },
    };
  }

  function buildBreakdown(breakdown) {
    if (!breakdown || !breakdown.length) return '';
    const items = breakdown.map(b => {
      const pts = b.points || 0;
      const yourAns = b.yourAnswer !== null && b.yourAnswer !== undefined ? b.yourAnswer : '—';
      const ptsClass = pts > 0 ? 'q-pts' : 'q-pts zero';
      return `<li><span class="q-text">${b.text} <em>(ans: ${b.correctAnswer}, you: ${yourAns})</em></span><span class="${ptsClass}">+${pts}</span></li>`;
    }).join('');
    return `<ul class="breakdown-list">${items}</ul>`;
  }

  function showGameOver({ mode, yourScore, opponentScore, result, newBest, breakdown, onPlayAgain, onHome }) {
    const emoji = result === 'win' ? '🏆' : result === 'loss' ? '😔' : result === 'draw' ? '🤝' : '✅';
    const title = result === 'win' ? 'You Win!' : result === 'loss' ? 'You Lose' : result === 'draw' ? 'Draw!' : 'Done!';

    let scoreHtml = `<div class="final-score">${yourScore} pts</div>`;
    if (mode === 'pvp') {
      scoreHtml += `<p class="text-muted text-center mt8" style="font-size:0.9rem">Opponent: ${opponentScore} pts</p>`;
    }

    const bestHtml = newBest ? `<p class="new-best">⭐ New personal best!</p>` : '';
    const breakHtml = buildBreakdown(breakdown);

    const box = showModal(`
      <div class="result-emoji">${emoji}</div>
      <h2 class="text-center" style="margin-bottom:12px">${title}</h2>
      ${scoreHtml}
      ${bestHtml}
      <hr class="divider">
      <p class="text-muted" style="font-size:0.8rem;margin-bottom:4px">Breakdown</p>
      ${breakHtml}
      <div class="btn-row mt16">
        ${mode === 'training' ? '<button class="btn btn-secondary" id="modal-again">Play Again</button>' : ''}
        <button class="btn btn-primary" id="modal-home">Home</button>
      </div>
    `);

    box.querySelector('#modal-home').addEventListener('click', () => { hideModal(); if (onHome) onHome(); });
    const againBtn = box.querySelector('#modal-again');
    if (againBtn) againBtn.addEventListener('click', () => { hideModal(); if (onPlayAgain) onPlayAgain(); });
  }

  return { showModal, hideModal, makeTimerBar, showGameOver };
})();
