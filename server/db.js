const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/game.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    best_score_training INTEGER NOT NULL DEFAULT 0,
    best_score_pvp INTEGER NOT NULL DEFAULT 0,
    total_games_played INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS game_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    mode TEXT NOT NULL,
    score INTEGER NOT NULL,
    questions_correct INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    opponent_username TEXT,
    result TEXT,
    played_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_game_history_user ON game_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_leaderboard_pvp ON users(best_score_pvp DESC);
  CREATE INDEX IF NOT EXISTS idx_leaderboard_training ON users(best_score_training DESC);
`);

const queries = {
  createUser: db.prepare(
    'INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)'
  ),
  findUserByUsername: db.prepare(
    'SELECT * FROM users WHERE username = ?'
  ),
  findUserById: db.prepare(
    'SELECT id, username, best_score_training, best_score_pvp, total_games_played FROM users WHERE id = ?'
  ),
  leaderboardPvp: db.prepare(
    'SELECT username, best_score_pvp AS best_score FROM users ORDER BY best_score_pvp DESC LIMIT ?'
  ),
  leaderboardTraining: db.prepare(
    'SELECT username, best_score_training AS best_score FROM users ORDER BY best_score_training DESC LIMIT ?'
  ),
  saveGame: db.prepare(
    `INSERT INTO game_history (user_id, mode, score, questions_correct, duration_seconds, opponent_username, result, played_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  updateBestScorePvp: db.prepare(
    'UPDATE users SET best_score_pvp = ?, total_games_played = total_games_played + 1 WHERE id = ? AND best_score_pvp < ?'
  ),
  updateBestScoreTraining: db.prepare(
    'UPDATE users SET best_score_training = ?, total_games_played = total_games_played + 1 WHERE id = ? AND best_score_training < ?'
  ),
  incrementGamesPlayed: db.prepare(
    'UPDATE users SET total_games_played = total_games_played + 1 WHERE id = ?'
  ),
  userHistory: db.prepare(
    'SELECT * FROM game_history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?'
  ),
};

function saveGameResult({ userId, mode, score, questionsCorrect, durationSeconds, opponentUsername, result }) {
  const now = Math.floor(Date.now() / 1000);
  queries.saveGame.run(userId, mode, score, questionsCorrect, durationSeconds, opponentUsername || null, result || null, now);

  if (mode === 'pvp') {
    const updated = queries.updateBestScorePvp.run(score, userId, score);
    if (updated.changes === 0) {
      queries.incrementGamesPlayed.run(userId);
    }
  } else {
    const updated = queries.updateBestScoreTraining.run(score, userId, score);
    if (updated.changes === 0) {
      queries.incrementGamesPlayed.run(userId);
    }
  }
}

module.exports = { db, queries, saveGameResult };
