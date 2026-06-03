const { generateSet } = require('./questionGen');
const { saveGameResult } = require('./db');
const { queries } = require('./db');

const pvpQueue = [];
const activeSessions = new Map();

const QUESTIONS_PER_GAME = 10;
const RECONNECT_WINDOW_MS = 10000;

function calcPoints(timeLimitMs, answeredAtMs, questionSentAt) {
  const elapsed = answeredAtMs - questionSentAt;
  const remaining = Math.max(0, timeLimitMs - elapsed);
  const speedBonus = Math.floor(50 * (remaining / timeLimitMs));
  return 100 + speedBonus;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ─── Training ────────────────────────────────────────────────────────────────

function startTraining(ws, userId, username, difficulty) {
  const sessionId = crypto.randomUUID();
  const questions = generateSet(difficulty);
  const session = {
    type: 'training',
    sessionId,
    userId,
    username,
    ws,
    questions,
    currentIndex: 0,
    score: 0,
    correctCount: 0,
    startedAt: Date.now(),
    questionSentAt: null,
    timeout: null,
    difficulty,
    breakdown: [],
  };
  activeSessions.set(sessionId, session);
  sendNextTrainingQuestion(session);
  return sessionId;
}

function sendNextTrainingQuestion(session) {
  if (session.currentIndex >= session.questions.length) {
    return endTraining(session);
  }
  const q = session.questions[session.currentIndex];
  session.questionSentAt = Date.now();
  send(session.ws, {
    type: 'question',
    sessionId: session.sessionId,
    questionId: q.questionId,
    number: session.currentIndex + 1,
    total: session.questions.length,
    text: q.text,
    timeLimitMs: q.timeLimitMs,
    serverTimestamp: session.questionSentAt,
  });
  session.timeout = setTimeout(() => {
    handleTrainingTimeout(session);
  }, q.timeLimitMs);
}

function handleTrainingTimeout(session) {
  const q = session.questions[session.currentIndex];
  session.breakdown.push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: null, points: 0 });
  send(session.ws, { type: 'question_timeout', sessionId: session.sessionId, questionId: q.questionId, correctAnswer: q.answer });
  session.currentIndex++;
  setTimeout(() => sendNextTrainingQuestion(session), 1500);
}

function handleTrainingAnswer(session, questionId, answer) {
  const q = session.questions[session.currentIndex];
  if (!q || q.questionId !== questionId) return;

  clearTimeout(session.timeout);
  const now = Date.now();
  const correct = Number(answer) === q.answer;
  const points = correct ? calcPoints(q.timeLimitMs, now, session.questionSentAt) : 0;

  if (correct) {
    session.score += points;
    session.correctCount++;
  }
  session.breakdown.push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: Number(answer), points });

  send(session.ws, {
    type: 'answer_result',
    sessionId: session.sessionId,
    questionId,
    correct,
    correctAnswer: q.answer,
    pointsEarned: points,
    totalScore: session.score,
    opponentAnswered: false,
  });

  session.currentIndex++;
  setTimeout(() => sendNextTrainingQuestion(session), correct ? 800 : 1500);
}

function endTraining(session) {
  clearTimeout(session.timeout);
  activeSessions.delete(session.sessionId);

  const durationSeconds = Math.round((Date.now() - session.startedAt) / 1000);
  const prevBest = queries.findUserById.get(session.userId)?.best_score_training || 0;

  saveGameResult({
    userId: session.userId,
    mode: 'training',
    score: session.score,
    questionsCorrect: session.correctCount,
    durationSeconds,
    opponentUsername: null,
    result: null,
  });

  const updatedUser = queries.findUserById.get(session.userId);
  const newBest = session.score > prevBest;

  send(session.ws, {
    type: 'game_over',
    sessionId: session.sessionId,
    mode: 'training',
    yourScore: session.score,
    opponentScore: null,
    result: null,
    newBest,
    breakdown: session.breakdown,
    updatedUser,
  });
}

// ─── PVP Matchmaking ─────────────────────────────────────────────────────────

function joinQueue(ws, userId, username) {
  if (pvpQueue.some(p => p.userId === userId)) {
    send(ws, { type: 'error', code: 'already_in_queue', message: 'You are already in the queue.' });
    return;
  }
  pvpQueue.push({ ws, userId, username });
  send(ws, { type: 'queue_status', position: pvpQueue.length });
  tryMatchmaking();
}

function leaveQueue(userId) {
  const idx = pvpQueue.findIndex(p => p.userId === userId);
  if (idx !== -1) pvpQueue.splice(idx, 1);
}

function tryMatchmaking() {
  if (pvpQueue.length < 2) return;
  const p1 = pvpQueue.shift();
  const p2 = pvpQueue.shift();
  createPvpSession(p1, p2);
}

function createPvpSession(p1, p2) {
  const sessionId = crypto.randomUUID();
  const questions = generateSet('medium');

  const p1User = queries.findUserById.get(p1.userId);
  const p2User = queries.findUserById.get(p2.userId);

  const session = {
    type: 'pvp',
    sessionId,
    players: {
      [p1.userId]: { ws: p1.ws, username: p1.username, score: 0, correctCount: 0, answered: false, answer: null, disconnected: false, reconnectTimer: null, bestScorePvp: p1User?.best_score_pvp || 0 },
      [p2.userId]: { ws: p2.ws, username: p2.username, score: 0, correctCount: 0, answered: false, answer: null, disconnected: false, reconnectTimer: null, bestScorePvp: p2User?.best_score_pvp || 0 },
    },
    playerIds: [p1.userId, p2.userId],
    questions,
    currentIndex: 0,
    startedAt: null,
    questionSentAt: null,
    timeout: null,
    breakdown: { [p1.userId]: [], [p2.userId]: [] },
  };

  activeSessions.set(sessionId, session);

  const startsInMs = 3000;
  const payload1 = { type: 'match_found', sessionId, opponent: { username: p2.username, bestScorePvp: session.players[p2.userId].bestScorePvp }, startsInMs };
  const payload2 = { type: 'match_found', sessionId, opponent: { username: p1.username, bestScorePvp: session.players[p1.userId].bestScorePvp }, startsInMs };
  send(p1.ws, payload1);
  send(p2.ws, payload2);

  session.startedAt = Date.now() + startsInMs;
  setTimeout(() => sendNextPvpQuestion(session), startsInMs);
}

function sendNextPvpQuestion(session) {
  if (session.currentIndex >= session.questions.length) {
    return endPvpSession(session);
  }
  const q = session.questions[session.currentIndex];
  session.questionSentAt = Date.now();
  session.playerIds.forEach(uid => {
    session.players[uid].answered = false;
    session.players[uid].answer = null;
  });

  const msg = {
    type: 'question',
    sessionId: session.sessionId,
    questionId: q.questionId,
    number: session.currentIndex + 1,
    total: session.questions.length,
    text: q.text,
    timeLimitMs: q.timeLimitMs,
    serverTimestamp: session.questionSentAt,
  };
  session.playerIds.forEach(uid => send(session.players[uid].ws, msg));

  session.timeout = setTimeout(() => handlePvpQuestionEnd(session, true), q.timeLimitMs);
}

function handlePvpAnswer(session, userId, questionId, answer) {
  const q = session.questions[session.currentIndex];
  if (!q || q.questionId !== questionId) return;

  const player = session.players[userId];
  if (player.answered) return;

  player.answered = true;
  player.answer = Number(answer);

  const now = Date.now();
  const correct = player.answer === q.answer;
  const points = correct ? calcPoints(q.timeLimitMs, now, session.questionSentAt) : 0;
  player.lastPoints = points;

  if (correct) {
    player.score += points;
    player.correctCount++;
  }

  const opponentId = session.playerIds.find(id => id !== userId);
  const opponentAnswered = session.players[opponentId]?.answered || false;

  const opponentScore = session.players[opponentId]?.score || 0;
  send(player.ws, {
    type: 'answer_result',
    sessionId: session.sessionId,
    questionId,
    correct,
    correctAnswer: q.answer,
    pointsEarned: points,
    totalScore: player.score,
    opponentScore,
    opponentAnswered,
  });

  if (opponentAnswered) {
    clearTimeout(session.timeout);
    setTimeout(() => handlePvpQuestionEnd(session, false), 800);
  }
}

function handlePvpQuestionEnd(session, timedOut) {
  const q = session.questions[session.currentIndex];

  session.playerIds.forEach(uid => {
    const player = session.players[uid];
    const opponentId = session.playerIds.find(id => id !== uid);
    const opponentAnswered = session.players[opponentId]?.answered || false;

    if (!player.answered) {
      session.breakdown[uid].push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: null, points: 0 });
      if (timedOut) {
        send(player.ws, { type: 'question_timeout', sessionId: session.sessionId, questionId: q.questionId, correctAnswer: q.answer });
      }
    } else {
      session.breakdown[uid].push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: player.answer, points: player.lastPoints || 0 });
    }
  });

  session.currentIndex++;
  setTimeout(() => sendNextPvpQuestion(session), timedOut ? 1500 : 800);
}

function endPvpSession(session, forfeitWinnerId = null) {
  clearTimeout(session.timeout);
  activeSessions.delete(session.sessionId);

  const [uid1, uid2] = session.playerIds;
  const p1 = session.players[uid1];
  const p2 = session.players[uid2];

  let result1, result2;
  if (forfeitWinnerId) {
    result1 = forfeitWinnerId === uid1 ? 'win' : 'loss';
    result2 = forfeitWinnerId === uid2 ? 'win' : 'loss';
  } else if (p1.score > p2.score) {
    result1 = 'win'; result2 = 'loss';
  } else if (p2.score > p1.score) {
    result1 = 'loss'; result2 = 'win';
  } else {
    result1 = result2 = 'draw';
  }

  const durationSeconds = Math.round((Date.now() - session.startedAt) / 1000);

  [uid1, uid2].forEach(uid => {
    const player = session.players[uid];
    const opponentId = session.playerIds.find(id => id !== uid);
    const opponent = session.players[opponentId];
    const result = uid === uid1 ? result1 : result2;
    const prevBest = queries.findUserById.get(uid)?.best_score_pvp || 0;

    saveGameResult({
      userId: uid,
      mode: 'pvp',
      score: player.score,
      questionsCorrect: player.correctCount,
      durationSeconds,
      opponentUsername: opponent.username,
      result,
    });

    const updatedUser = queries.findUserById.get(uid);
    send(player.ws, {
      type: 'game_over',
      sessionId: session.sessionId,
      mode: 'pvp',
      yourScore: player.score,
      opponentScore: opponent.score,
      result,
      newBest: player.score > prevBest,
      breakdown: session.breakdown[uid],
      updatedUser,
    });
  });
}

function handlePvpDisconnect(userId) {
  for (const [, session] of activeSessions) {
    if (session.type !== 'pvp') continue;
    if (!session.players[userId]) continue;

    const player = session.players[userId];
    player.disconnected = true;

    const opponentId = session.playerIds.find(id => id !== userId);
    send(session.players[opponentId]?.ws, { type: 'opponent_disconnected', sessionId: session.sessionId });

    player.reconnectTimer = setTimeout(() => {
      if (player.disconnected) {
        endPvpSession(session, opponentId);
      }
    }, RECONNECT_WINDOW_MS);
    break;
  }
}

function handleReconnect(ws, userId) {
  for (const [, session] of activeSessions) {
    if (session.type !== 'pvp') continue;
    if (!session.players[userId]) continue;

    const player = session.players[userId];
    clearTimeout(player.reconnectTimer);
    player.ws = ws;
    player.disconnected = false;

    const opponentId = session.playerIds.find(id => id !== userId);
    send(ws, { type: 'reconnected', sessionId: session.sessionId, opponentUsername: session.players[opponentId]?.username });
    return true;
  }
  return false;
}

function getActiveSession(sessionId) {
  return activeSessions.get(sessionId) || null;
}

function getUserSession(userId) {
  for (const [, session] of activeSessions) {
    if (session.type === 'training' && session.userId === userId) return session;
    if (session.type === 'pvp' && session.players[userId]) return session;
  }
  return null;
}

module.exports = {
  startTraining,
  handleTrainingAnswer,
  joinQueue,
  leaveQueue,
  handlePvpAnswer,
  handlePvpDisconnect,
  handleReconnect,
  getActiveSession,
  getUserSession,
};
