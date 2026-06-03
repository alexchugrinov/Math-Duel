const { WebSocketServer } = require('ws');
const { verifyToken } = require('./auth');
const {
  startTraining,
  handleTrainingAnswer,
  joinQueue,
  leaveQueue,
  handlePvpAnswer,
  handlePvpDisconnect,
  handleReconnect,
  getActiveSession,
} = require('./gameManager');

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function createWsServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    ws.userId = null;
    ws.username = null;
    ws.authenticated = false;

    const authTimeout = setTimeout(() => {
      if (!ws.authenticated) ws.close(4001, 'Auth timeout');
    }, 5000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (!ws.authenticated) {
        if (msg.type === 'auth') handleAuth(ws, msg, authTimeout);
        return;
      }

      switch (msg.type) {
        case 'training_start':
          handleTrainingStart(ws, msg);
          break;
        case 'answer_submit':
          handleAnswer(ws, msg);
          break;
        case 'training_end':
          // silently allow early exit; session will be cleaned by gc if needed
          break;
        case 'queue_join':
          joinQueue(ws, ws.userId, ws.username);
          break;
        case 'queue_leave':
          leaveQueue(ws.userId);
          send(ws, { type: 'queue_left' });
          break;
        default:
          send(ws, { type: 'error', code: 'unknown_message', message: 'Unknown message type.' });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (ws.userId) handlePvpDisconnect(ws.userId);
    });

    ws.on('error', () => {});
  });
}

function handleAuth(ws, msg, authTimeout) {
  if (!msg.token) {
    send(ws, { type: 'auth_fail', reason: 'missing_token' });
    return;
  }
  try {
    const payload = verifyToken(msg.token);
    clearTimeout(authTimeout);
    ws.userId = payload.userId;
    ws.username = payload.username;
    ws.authenticated = true;

    // Try to reconnect to an existing PVP session
    handleReconnect(ws, ws.userId);

    const { queries } = require('./db');
    const user = queries.findUserById.get(ws.userId);
    send(ws, { type: 'auth_ok', user });
  } catch {
    send(ws, { type: 'auth_fail', reason: 'invalid_token' });
  }
}

function handleTrainingStart(ws, msg) {
  const diff = ['easy', 'medium', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'medium';
  startTraining(ws, ws.userId, ws.username, diff);
}

function handleAnswer(ws, msg) {
  const { sessionId, questionId, answer } = msg;
  if (!sessionId || !questionId || answer === undefined) return;

  const session = getActiveSession(sessionId);
  if (!session) {
    send(ws, { type: 'error', code: 'session_not_found', message: 'Session not found.' });
    return;
  }

  if (session.type === 'training') {
    handleTrainingAnswer(session, questionId, answer);
  } else if (session.type === 'pvp') {
    handlePvpAnswer(session, ws.userId, questionId, answer);
  }
}

module.exports = { createWsServer };
