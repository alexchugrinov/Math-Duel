const { generateSet } = require('./questionGen');
const { saveGameResult, queries } = require('./db');

const pvpQueue = [];
const activeSessions = new Map();

const QUESTIONS_PER_GAME = 10;
const RECONNECT_WINDOW_MS = 10000;

function calcPoints(timeLimitMs, answeredAtMs, questionSentAt) {
  const elapsed = answeredAtMs - questionSentAt;
  const remaining = Math.max(0, timeLimitMs - elapsed);
  return 100 + Math.floor(50 * (remaining / timeLimitMs));
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ─── Training ────────────────────────────────────────────────────────────────

function startTraining(ws, userId, username, difficulty) {
  const sessionId = crypto.randomUUID();
  const questions = generateSet(difficulty);
  const session = {
    type: 'training', sessionId, userId, username, ws,
    questions, currentIndex: 0, score: 0, correctCount: 0,
    startedAt: Date.now(), questionSentAt: null, timeout: null,
    difficulty, breakdown: [],
  };
  activeSessions.set(sessionId, session);
  sendNextTrainingQuestion(session);
  return sessionId;
}

function sendNextTrainingQuestion(session) {
  if (session.currentIndex >= session.questions.length) return endTraining(session);
  const q = session.questions[session.currentIndex];
  session.questionSentAt = Date.now();
  send(session.ws, {
    type: 'question', sessionId: session.sessionId, questionId: q.questionId,
    number: session.currentIndex + 1, total: session.questions.length,
    text: q.text, timeLimitMs: q.timeLimitMs, serverTimestamp: session.questionSentAt,
  });
  session.timeout = setTimeout(() => {
    session.breakdown.push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: null, points: 0 });
    send(session.ws, { type: 'question_timeout', sessionId: session.sessionId, questionId: q.questionId, correctAnswer: q.answer });
    session.currentIndex++;
    setTimeout(() => sendNextTrainingQuestion(session), 1500);
  }, q.timeLimitMs);
}

function handleTrainingAnswer(session, questionId, answer) {
  const q = session.questions[session.currentIndex];
  if (!q || q.questionId !== questionId) return;
  clearTimeout(session.timeout);

  const now = Date.now();
  const correct = Number(answer) === q.answer;
  const points = correct ? calcPoints(q.timeLimitMs, now, session.questionSentAt) : 0;
  if (correct) { session.score += points; session.correctCount++; }
  session.breakdown.push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: Number(answer), points });

  send(session.ws, {
    type: 'answer_result', sessionId: session.sessionId, questionId,
    correct, correctAnswer: q.answer, pointsEarned: points, totalScore: session.score,
  });

  session.currentIndex++;
  setTimeout(() => sendNextTrainingQuestion(session), correct ? 800 : 1500);
}

function endTraining(session) {
  clearTimeout(session.timeout);
  activeSessions.delete(session.sessionId);
  const durationSeconds = Math.round((Date.now() - session.startedAt) / 1000);
  const prevBest = queries.findUserById.get(session.userId)?.best_score_training || 0;
  saveGameResult({ userId: session.userId, mode: 'training', score: session.score, questionsCorrect: session.correctCount, durationSeconds, opponentUsername: null, result: null });
  const updatedUser = queries.findUserById.get(session.userId);
  send(session.ws, { type: 'game_over', sessionId: session.sessionId, mode: 'training', yourScore: session.score, opponentScore: null, result: null, newBest: session.score > prevBest, breakdown: session.breakdown, updatedUser });
}

// ─── PVP Matchmaking ─────────────────────────────────────────────────────────

function joinQueue(ws, userId, username) {
  if (pvpQueue.some(p => p.userId === userId)) {
    send(ws, { type: 'error', code: 'already_in_queue', message: 'Already in queue.' }); return;
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
  createPvpSession(pvpQueue.shift(), pvpQueue.shift());
}

// ─── PVP Session ─────────────────────────────────────────────────────────────

function createPvpSession(p1, p2) {
  const sessionId = crypto.randomUUID();
  const questions = generateSet('medium');
  const p1User = queries.findUserById.get(p1.userId);
  const p2User = queries.findUserById.get(p2.userId);

  function makePlayer(p, user) {
    return { ws: p.ws, username: p.username, score: 0, correctCount: 0, currentIndex: 0, questionSentAt: null, timeout: null, finished: false, breakdown: [], lastPoints: 0, disconnected: false, reconnectTimer: null, bestScorePvp: user?.best_score_pvp || 0 };
  }

  const session = {
    type: 'pvp', sessionId,
    players: { [p1.userId]: makePlayer(p1, p1User), [p2.userId]: makePlayer(p2, p2User) },
    playerIds: [p1.userId, p2.userId],
    questions,
    startedAt: Date.now() + 3000,
  };
  activeSessions.set(sessionId, session);

  const startsInMs = 3000;
  send(p1.ws, { type: 'match_found', sessionId, opponent: { username: p2.username, bestScorePvp: session.players[p2.userId].bestScorePvp }, startsInMs });
  send(p2.ws, { type: 'match_found', sessionId, opponent: { username: p1.username, bestScorePvp: session.players[p1.userId].bestScorePvp }, startsInMs });

  setTimeout(() => {
    session.playerIds.forEach(uid => sendNextQuestionToPlayer(session, uid));
  }, startsInMs);
}

// Send the next question to one specific player independently
function sendNextQuestionToPlayer(session, userId) {
  const player = session.players[userId];
  if (!player || player.finished || player.disconnected) return;

  if (player.currentIndex >= session.questions.length) {
    player.finished = true;
    const allDone = session.playerIds.every(id => session.players[id].finished);
    if (allDone) {
      endPvpSession(session);
    } else {
      send(player.ws, { type: 'waiting_for_opponent', sessionId: session.sessionId });
    }
    return;
  }

  const q = session.questions[player.currentIndex];
  player.questionSentAt = Date.now();

  send(player.ws, {
    type: 'question', sessionId: session.sessionId, questionId: q.questionId,
    number: player.currentIndex + 1, total: session.questions.length,
    text: q.text, timeLimitMs: q.timeLimitMs, serverTimestamp: player.questionSentAt,
  });

  player.timeout = setTimeout(() => {
    player.breakdown.push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: null, points: 0 });
    send(player.ws, { type: 'question_timeout', sessionId: session.sessionId, questionId: q.questionId, correctAnswer: q.answer });
    player.currentIndex++;
    setTimeout(() => sendNextQuestionToPlayer(session, userId), 1000);
  }, q.timeLimitMs);
}

function handlePvpAnswer(session, userId, questionId, answer) {
  const player = session.players[userId];
  if (!player) return;
  const q = session.questions[player.currentIndex];
  if (!q || q.questionId !== questionId) return;

  clearTimeout(player.timeout);

  const now = Date.now();
  const correct = Number(answer) === q.answer;
  const points = correct ? calcPoints(q.timeLimitMs, now, player.questionSentAt) : 0;
  player.lastPoints = points;
  if (correct) { player.score += points; player.correctCount++; }

  const opponentId = session.playerIds.find(id => id !== userId);
  const opponent = session.players[opponentId];

  player.breakdown.push({ questionId: q.questionId, text: q.text, correctAnswer: q.answer, yourAnswer: Number(answer), points });

  send(player.ws, {
    type: 'answer_result', sessionId: session.sessionId, questionId,
    correct, correctAnswer: q.answer, pointsEarned: points,
    totalScore: player.score, opponentScore: opponent?.score || 0,
  });

  // Push your updated score to the opponent
  if (opponent) {
    send(opponent.ws, { type: 'opponent_scored', sessionId: session.sessionId, opponentScore: player.score });
  }

  player.currentIndex++;
  // Immediately advance this player to their next question
  setTimeout(() => sendNextQuestionToPlayer(session, userId), 800);
}

function endPvpSession(session, forfeitWinnerId = null) {
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

    saveGameResult({ userId: uid, mode: 'pvp', score: player.score, questionsCorrect: player.correctCount, durationSeconds, opponentUsername: opponent.username, result });
    const updatedUser = queries.findUserById.get(uid);

    send(player.ws, {
      type: 'game_over', sessionId: session.sessionId, mode: 'pvp',
      yourScore: player.score, opponentScore: opponent.score,
      result, newBest: player.score > prevBest,
      breakdown: player.breakdown, updatedUser,
    });
  });
}

function handlePvpDisconnect(userId) {
  for (const [, session] of activeSessions) {
    if (session.type !== 'pvp' || !session.players[userId]) continue;
    const player = session.players[userId];
    player.disconnected = true;
    clearTimeout(player.timeout);
    const opponentId = session.playerIds.find(id => id !== userId);
    send(session.players[opponentId]?.ws, { type: 'opponent_disconnected', sessionId: session.sessionId });
    player.reconnectTimer = setTimeout(() => {
      if (player.disconnected) endPvpSession(session, opponentId);
    }, RECONNECT_WINDOW_MS);
    break;
  }
}

function handleReconnect(ws, userId) {
  for (const [, session] of activeSessions) {
    if (session.type !== 'pvp' || !session.players[userId]) continue;
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

module.exports = {
  startTraining, handleTrainingAnswer,
  joinQueue, leaveQueue,
  createPvpSession, handlePvpAnswer,
  handlePvpDisconnect, handleReconnect, getActiveSession,
};
