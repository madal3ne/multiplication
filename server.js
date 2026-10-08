import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import express from 'express'

const root = path.dirname(fileURLToPath(import.meta.url))
const dataDirectory = process.env.DATA_DIR || path.join(root, 'data')
mkdirSync(dataDirectory, { recursive: true })

const database = new Database(path.join(dataDirectory, 'multiplication.sqlite'))
database.pragma('journal_mode = WAL')
database.pragma('foreign_keys = ON')
database.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    answered_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    current_streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL REFERENCES players(id),
    left_factor INTEGER NOT NULL,
    right_factor INTEGER NOT NULL,
    is_correct INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS answers_fact_idx
    ON answers(left_factor, right_factor);
  CREATE INDEX IF NOT EXISTS answers_player_idx
    ON answers(player_id);
  CREATE UNIQUE INDEX IF NOT EXISTS players_name_unique
    ON players(name COLLATE NOCASE);
`)

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '8kb' }))

const getPlayer = database.prepare(`
  SELECT id, name, answered_count AS answered, correct_count AS correct,
    current_streak AS streak, best_streak AS bestStreak,
    CASE WHEN answered_count = 0 THEN 0
      ELSE ROUND(correct_count * 100.0 / answered_count) END AS accuracy
  FROM players WHERE id = ?
`)

const getLeaderboard = database.prepare(`
  SELECT name, answered_count AS answered, correct_count AS correct,
    best_streak AS bestStreak,
    CASE WHEN answered_count = 0 THEN 0
      ELSE ROUND(correct_count * 100.0 / answered_count) END AS accuracy
  FROM players
  WHERE answered_count > 0
  ORDER BY correct_count DESC, accuracy DESC, answered_count DESC, name COLLATE NOCASE ASC
  LIMIT ?
`)

app.get('/api/health', (_request, response) => response.json({ ok: true }))

app.post('/api/players', (request, response) => {
  const { id, name } = request.body ?? {}
  const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
    return response.status(400).json({ error: 'A valid player id is required.' })
  }
  if (cleanName.length < 1 || cleanName.length > 20) {
    return response.status(400).json({ error: 'Player names must be 1 to 20 characters.' })
  }
  const existingName = database.prepare(
    'SELECT id FROM players WHERE name = ? COLLATE NOCASE AND id <> ?',
  ).get(cleanName, id)
  if (existingName) return response.status(409).json({ error: 'That player name is already in use.' })

  try {
    database.prepare(`
      INSERT INTO players (id, name) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen_at = CURRENT_TIMESTAMP
    `).run(id, cleanName)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      return response.status(409).json({ error: 'That player name is already in use.' })
    }
    throw error
  }
  return response.json(getPlayer.get(id))
})

app.get('/api/players/:id', (request, response) => {
  const player = getPlayer.get(request.params.id)
  if (!player) return response.status(404).json({ error: 'Player not found.' })
  return response.json(player)
})

app.get('/api/leaderboard', (_request, response) => {
  return response.json(getLeaderboard.all(20))
})

app.get('/api/weights', (request, response) => {
  const limit = Number(request.query.limit)
  if (![5, 10, 12].includes(limit)) {
    return response.status(400).json({ error: 'Table range must be 5, 10, or 12.' })
  }

  const facts = database.prepare(`
    SELECT left_factor AS left, right_factor AS right,
      COUNT(*) AS attempts,
      SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS wrong
    FROM answers
    WHERE left_factor <= ? AND right_factor <= ?
    GROUP BY left_factor, right_factor
  `).all(limit, limit).map((fact) => ({
    ...fact,
    weight: 1 + fact.wrong * 2 + Math.round((fact.wrong / fact.attempts) * 8),
  }))
  return response.json(facts)
})

app.post('/api/answers', (request, response) => {
  const { playerId, left, right, answer } = request.body ?? {}
  if (typeof playerId !== 'string' || !getPlayer.get(playerId)) {
    return response.status(404).json({ error: 'Register your player before answering.' })
  }
  if (![left, right, answer].every(Number.isInteger) || left < 2 || right < 2 || left > 12 || right > 12 || answer < 0 || answer > 999) {
    return response.status(400).json({ error: 'The multiplication fact or answer is invalid.' })
  }

  const isCorrect = answer === left * right
  const recordAnswer = database.transaction(() => {
    database.prepare(`
      INSERT INTO answers (player_id, left_factor, right_factor, is_correct)
      VALUES (?, ?, ?, ?)
    `).run(playerId, left, right, Number(isCorrect))
    database.prepare(`
      UPDATE players SET
        answered_count = answered_count + 1,
        correct_count = correct_count + ?,
        current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
        best_streak = MAX(best_streak, CASE WHEN ? = 1 THEN current_streak + 1 ELSE current_streak END),
        last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(Number(isCorrect), Number(isCorrect), Number(isCorrect), playerId)
  })
  recordAnswer()

  return response.json({ isCorrect, correctAnswer: left * right, player: getPlayer.get(playerId) })
})

app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }))

const distDirectory = path.join(root, 'dist')
app.use(express.static(distDirectory))
app.get(/.*/, (_request, response) => response.sendFile(path.join(distDirectory, 'index.html')))

const port = Number(process.env.PORT) || 3001
app.listen(port, '0.0.0.0', () => {
  console.log(`Multiplication trainer listening on ${port}; SQLite database: ${path.join(dataDirectory, 'multiplication.sqlite')}`)
})