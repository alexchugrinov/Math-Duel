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
  createPvpSession,
} = require('./gameManager');

// userId → { ws, userId, username }
const onlineUsers = new Map();
// targetUserId → { fromUserId, fromUsername, timer }
const pendingChallenges = new Map();

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcastOnlineUsers() {
  const all = Array.from(onlineUsers.values()).map(u => ({ userId: u.userId, username: u.username }));
  for (const [uid, u] of onlineUsers) {
    send(u.ws, { type: 'online_users', users: all.filter(x => x.userId !== uid) });
  }
}

function cancelChallengesForUser(userId) {
  // challenges this user sent
  for (const [tid, c] of pendingChallenges) {
    if (c.fromUserId === userId) {
      clearTimeout(c.timer);
      pendingChallenges.delete(tid);
      const target = onlineUsers.get(tid);
      if (target) send(target.ws, { type: 'challenge_cancelled', fromUsername: c.fromUsername });
    }
  }
  // challenges sent to this user
  const incoming = pendingChallenges.get(userId);
  if (incoming) {
    clearTimeout(incoming.timer);
    pendingChallenges.delete(userId);
    const from = onlineUsers.get(incoming.fromUserId);
    if (from) send(from.ws, { type: 'challenge_declined', targetUsername: '(disconnected)' });
  }
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
        case 'training_start':   handleTrainingStart(ws, msg); break;
        case 'answer_submit':    handleAnswer(ws, msg); break;
        case 'queue_join':       joinQueue(ws, ws.userId, ws.username); break;
        case 'queue_leave':      leaveQueue(ws.userId); send(ws, { type: 'queue_left' }); break;
        case 'challenge_user':   handleChallengeUser(ws, msg); break;
        case 'accept_challenge': handleAcceptChallenge(ws, msg); break;
        case 'decline_challenge':handleDeclineChallenge(ws, msg); break;
        case 'cancel_challenge': handleCancelChallenge(ws, msg); break;
        case 'request_online_users': {
          const others = Array.from(onlineUsers.values())
            .filter(u => u.userId !== ws.userId)
            .map(u => ({ userId: u.userId, username: u.username }));
          send(ws, { type: 'online_users', users: others });
          break;
        }
        default:
          send(ws, { type: 'error', code: 'unknown_message', message: 'Unknown message type.' });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (ws.userId) {
        onlineUsers.delete(ws.userId);
        broadcastOnlineUsers();
        cancelChallengesForUser(ws.userId);
        handlePvpDisconnect(ws.userId);
      }
    });

    ws.on('error', () => {});
  });
}

function handleAuth(ws, msg, authTimeout) {
  if (!msg.token) { send(ws, { type: 'auth_fail', reason: 'missing_token' }); return; }
  try {
    const payload = verifyToken(msg.token);
    clearTimeout(authTimeout);
    ws.userId = payload.userId;
    ws.username = payload.username;
    ws.authenticated = true;

    onlineUsers.set(ws.userId, { ws, userId: ws.userId, username: ws.username });
    handleReconnect(ws, ws.userId);

    const { queries } = require('./db');
    const user = queries.findUserById.get(ws.userId);
    const others = Array.from(onlineUsers.values())
      .filter(u => u.userId !== ws.userId)
      .map(u => ({ userId: u.userId, username: u.username }));

    send(ws, { type: 'auth_ok', user, onlineUsers: others });
    broadcastOnlineUsers();
  } catch {
    send(ws, { type: 'auth_fail', reason: 'invalid_token' });
  }
}

function handleChallengeUser(ws, msg) {
  const { targetUserId } = msg;
  if (targetUserId === ws.userId) return;

  const target = onlineUsers.get(targetUserId);
  if (!target) { send(ws, { type: 'challenge_error', reason: 'user_offline' }); return; }

  // Cancel any previous challenge this user sent
  for (const [tid, c] of pendingChallenges) {
    if (c.fromUserId === ws.userId) {
      clearTimeout(c.timer);
      pendingChallenges.delete(tid);
    }
  }

  const timer = setTimeout(() => {
    if (pendingChallenges.get(targetUserId)?.fromUserId === ws.userId) {
      pendingChallenges.delete(targetUserId);
      send(ws, { type: 'challenge_timeout', targetUsername: target.username });
    }
  }, 30000);

  pendingChallenges.set(targetUserId, { fromUserId: ws.userId, fromUsername: ws.username, timer });
  send(target.ws, { type: 'challenge_received', fromUserId: ws.userId, fromUsername: ws.username });
  send(ws, { type: 'challenge_sent', targetUserId, targetUsername: target.username });
}

function handleAcceptChallenge(ws, msg) {
  const { fromUserId } = msg;
  const pending = pendingChallenges.get(ws.userId);
  if (!pending || pending.fromUserId !== fromUserId) {
    send(ws, { type: 'challenge_error', reason: 'no_pending_challenge' }); return;
  }
  clearTimeout(pending.timer);
  pendingChallenges.delete(ws.userId);

  const challenger = onlineUsers.get(fromUserId);
  if (!challenger) { send(ws, { type: 'challenge_error', reason: 'challenger_offline' }); return; }

  createPvpSession(
    { ws: challenger.ws, userId: fromUserId, username: challenger.username },
    { ws, userId: ws.userId, username: ws.username }
  );
}

function handleDeclineChallenge(ws, msg) {
  const { fromUserId } = msg;
  const pending = pendingChallenges.get(ws.userId);
  if (!pending || pending.fromUserId !== fromUserId) return;
  clearTimeout(pending.timer);
  pendingChallenges.delete(ws.userId);

  const challenger = onlineUsers.get(fromUserId);
  if (challenger) send(challenger.ws, { type: 'challenge_declined', targetUsername: ws.username });
}

function handleCancelChallenge(ws, msg) {
  const { targetUserId } = msg;
  const pending = pendingChallenges.get(targetUserId);
  if (!pending || pending.fromUserId !== ws.userId) return;
  clearTimeout(pending.timer);
  pendingChallenges.delete(targetUserId);

  const target = onlineUsers.get(targetUserId);
  if (target) send(target.ws, { type: 'challenge_cancelled', fromUsername: ws.username });
}

function handleTrainingStart(ws, msg) {
  const diff = ['easy', 'medium', 'hard'].includes(msg.difficulty) ? msg.difficulty : 'medium';
  startTraining(ws, ws.userId, ws.username, diff);
}

function handleAnswer(ws, msg) {
  const { sessionId, questionId, answer } = msg;
  if (!sessionId || !questionId || answer === undefined) return;

  const session = getActiveSession(sessionId);
  if (!session) { send(ws, { type: 'error', code: 'session_not_found', message: 'Session not found.' }); return; }

  if (session.type === 'training') {
    handleTrainingAnswer(session, questionId, answer);
  } else if (session.type === 'pvp') {
    handlePvpAnswer(session, ws.userId, questionId, answer);
  }
}

module.exports = { createWsServer };
