const express = require('express');
const { register, login, authMiddleware } = require('./auth');
const { queries } = require('./db');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  const result = await register(username, password);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(201).json(result);
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const result = await login(username, password);
  if (result.error) return res.status(401).json({ error: result.error });
  res.json(result);
});

router.get('/leaderboard', (req, res) => {
  const mode = req.query.mode === 'training' ? 'training' : 'pvp';
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const rows = mode === 'pvp'
    ? queries.leaderboardPvp.all(limit)
    : queries.leaderboardTraining.all(limit);

  const entries = rows.map((row, i) => ({ rank: i + 1, username: row.username, best_score: row.best_score }));
  res.json({ mode, entries });
});

router.get('/me', authMiddleware, (req, res) => {
  const user = queries.findUserById.get(req.user.userId);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  res.json({ user });
});

router.get('/history', authMiddleware, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const games = queries.userHistory.all(req.user.userId, limit);
  res.json({ games });
});

module.exports = router;
