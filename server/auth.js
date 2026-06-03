const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { queries } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRY = '30d';
const SALT_ROUNDS = 10;

function signToken(userId, username) {
  return jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function register(username, password) {
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return { error: 'invalid_username' };
  }
  if (!password || password.length < 6 || password.length > 100) {
    return { error: 'password_too_short' };
  }

  const existing = queries.findUserByUsername.get(username);
  if (existing) return { error: 'username_taken' };

  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  const now = Math.floor(Date.now() / 1000);
  const info = queries.createUser.run(username, hash, now);
  const userId = info.lastInsertRowid;

  const token = signToken(userId, username);
  return { token, user: { id: userId, username } };
}

async function login(username, password) {
  const user = queries.findUserByUsername.get(username);
  if (!user) return { error: 'invalid_credentials' };

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return { error: 'invalid_credentials' };

  const token = signToken(user.id, user.username);
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      best_score_pvp: user.best_score_pvp,
      best_score_training: user.best_score_training,
    },
  };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

module.exports = { register, login, verifyToken, authMiddleware };
