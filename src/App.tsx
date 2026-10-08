import { useEffect, useRef, useState } from 'react'
import './App.css'

type Fact = { left: number; right: number }
type Review = Fact & { dueAt: number; misses: number }
type FactWeight = Fact & { attempts: number; wrong: number; weight: number }
type Player = { id: string; name: string }
type PlayerStats = Player & {
  answered: number
  correct: number
  accuracy: number
  streak: number
  bestStreak: number
}
type LeaderboardEntry = Omit<PlayerStats, 'id'>
type SavedProgress = {
  limit: number
  asked: string[]
  reviews: Review[]
  answered: number
  correct: number
  streak: number
  bestStreak: number
  current: Fact
}

const STORAGE_KEY = 'times-table-trainer-progress'
const PLAYER_KEY = 'times-table-trainer-player'
const RANGES = [5, 10, 12]

function factKey(fact: Fact) {
  return `${fact.left}x${fact.right}`
}

function makeFactPool(limit: number): Fact[] {
  return Array.from({ length: (limit - 1) ** 2 }, (_, index) => ({
    left: Math.floor(index / (limit - 1)) + 2,
    right: (index % (limit - 1)) + 2,
  }))
}

function pickWeighted<T extends Fact>(choices: T[], weightOf: (choice: T) => number): T {
  const weights = choices.map((choice) => Math.max(1, weightOf(choice)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let selection = Math.random() * total
  for (let index = 0; index < choices.length; index += 1) {
    selection -= weights[index]
    if (selection < 0) return choices[index]
  }
  return choices[choices.length - 1]
}

function pickQuestion(
  limit: number,
  asked: string[],
  reviews: Review[],
  answered: number,
  weights: FactWeight[] = [],
  previous?: Fact,
): Fact {
  const weightByKey = new Map(weights.map((fact) => [factKey(fact), fact.weight]))
  const dueReviews = reviews.filter((fact) => fact.dueAt <= answered)
  if (dueReviews.length) {
    return pickWeighted(dueReviews, (fact) => (weightByKey.get(factKey(fact)) ?? 1) + fact.misses * 2)
  }

  const choices = makeFactPool(limit).filter((fact) => !previous || factKey(fact) !== factKey(previous))
  return pickWeighted(choices, (fact) =>
    (weightByKey.get(factKey(fact)) ?? 1) + (asked.includes(factKey(fact)) ? 0 : 2),
  )
}

function newProgress(limit: number): SavedProgress {
  return {
    limit,
    asked: [],
    reviews: [],
    answered: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    current: pickQuestion(limit, [], [], 0),
  }
}

function loadProgress(): SavedProgress {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const progress = JSON.parse(saved) as SavedProgress
      if (RANGES.includes(progress.limit) && progress.current?.left && progress.current?.right) {
        return progress
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
  }
  return newProgress(5)
}

function loadPlayer(): Player {
  try {
    const saved = localStorage.getItem(PLAYER_KEY)
    if (saved) {
      const player = JSON.parse(saved) as Player
      if (player.id && player.name) return player
    }
  } catch {
    localStorage.removeItem(PLAYER_KEY)
  }
  const id = crypto.randomUUID()
  return { id, name: `Player-${id.slice(0, 8).toUpperCase()}` }
}

function App() {
  const [progress, setProgress] = useState<SavedProgress>(loadProgress)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null)
  const [player, setPlayer] = useState<Player>(loadPlayer)
  const [playerName, setPlayerName] = useState(player.name)
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [factWeights, setFactWeights] = useState<FactWeight[]>([])
  const [apiStatus, setApiStatus] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const answerInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  }, [progress])

  useEffect(() => {
    localStorage.setItem(PLAYER_KEY, JSON.stringify(player))
  }, [player])

  useEffect(() => {
    let active = true
    async function connectPlayer() {
      try {
        const response = await fetch('/api/players', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(player),
        })
        if (!response.ok) throw new Error('Player registration failed')
        const stats = await response.json() as PlayerStats
        if (!active) return
        setPlayerStats(stats)
        setPlayerName(stats.name)
        setApiStatus('online')
        const [boardResponse, weightsResponse] = await Promise.all([
          fetch('/api/leaderboard'),
          fetch(`/api/weights?limit=${progress.limit}`),
        ])
        if (!boardResponse.ok || !weightsResponse.ok) throw new Error('Shared data failed to load')
        const [board, weights] = await Promise.all([
          boardResponse.json() as Promise<PlayerStats[]>,
          weightsResponse.json() as Promise<FactWeight[]>,
        ])
        if (!active) return
        setLeaderboard(board)
        setFactWeights(weights)
      } catch {
        if (active) setApiStatus('offline')
      }
    }
    void connectPlayer()
    return () => { active = false }
  }, [player, progress.limit])

  useEffect(() => {
    if (!feedback) answerInputRef.current?.focus()
  }, [feedback])

  useEffect(() => {
    if (!feedback) return

    function handleContinue(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.repeat) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('button, a, input, select, textarea')) return

      event.preventDefault()
      setProgress((current) => ({
        ...current,
        current: pickQuestion(current.limit, current.asked, current.reviews, current.answered, factWeights, current.current),
      }))
      setAnswer('')
      setFeedback(null)
    }

    window.addEventListener('keydown', handleContinue)
    return () => window.removeEventListener('keydown', handleContinue)
  }, [feedback, factWeights])

  const pendingCount = progress.reviews.length
  const displayAnswered = playerStats?.answered ?? progress.answered
  const displayAccuracy = playerStats?.accuracy ?? (progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0)
  const questionNumber = displayAnswered + 1

  async function refreshSharedData() {
    const [playerResponse, boardResponse, weightsResponse] = await Promise.all([
      fetch(`/api/players/${player.id}`),
      fetch('/api/leaderboard'),
      fetch(`/api/weights?limit=${progress.limit}`),
    ])
    if (!playerResponse.ok || !boardResponse.ok || !weightsResponse.ok) throw new Error('Shared data refresh failed')
    const [stats, board, weights] = await Promise.all([
      playerResponse.json() as Promise<PlayerStats>,
      boardResponse.json() as Promise<PlayerStats[]>,
      weightsResponse.json() as Promise<FactWeight[]>,
    ])
    setPlayerStats(stats)
    setLeaderboard(board)
    setFactWeights(weights)
    setApiStatus('online')
  }

  async function savePlayerName(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = playerName.trim().replace(/\s+/g, ' ')
    if (!name) return
    setPlayer({ ...player, name })
    setPlayerName(name)
    try {
      const response = await fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...player, name }),
      })
      if (!response.ok) throw new Error('Name update failed')
      setPlayerStats(await response.json() as PlayerStats)
      setApiStatus('online')
      await refreshSharedData()
    } catch {
      setApiStatus('offline')
    }
  }

  function changeRange(limit: number) {
    if (limit !== progress.limit) {
      setProgress({ ...newProgress(limit), current: pickQuestion(limit, [], [], 0, factWeights) })
      setAnswer('')
      setFeedback(null)
    }
  }

  function submitAnswer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (feedback || answer.trim() === '') return

    const isCorrect = Number(answer) === progress.current.left * progress.current.right
    const answered = progress.answered + 1
    const key = factKey(progress.current)
    const existingReview = progress.reviews.find((fact) => factKey(fact) === key)

    setFeedback(isCorrect ? 'correct' : 'wrong')
    setProgress({
      ...progress,
      answered,
      correct: progress.correct + Number(isCorrect),
      streak: isCorrect ? progress.streak + 1 : 0,
      bestStreak: isCorrect ? Math.max(progress.bestStreak, progress.streak + 1) : progress.bestStreak,
      asked: progress.asked.includes(key) ? progress.asked : [...progress.asked, key],
      reviews: isCorrect
        ? progress.reviews.filter((fact) => factKey(fact) !== key)
        : [
            ...progress.reviews.filter((fact) => factKey(fact) !== key),
            {
              ...progress.current,
              dueAt: answered + 2,
              misses: (existingReview?.misses ?? 0) + 1,
            },
          ],
    })
        void fetch('/api/answers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerId: player.id,
            left: progress.current.left,
            right: progress.current.right,
            answer: Number(answer),
          }),
        }).then(async (response) => {
          if (!response.ok) throw new Error('Answer could not be saved')
          const result = await response.json() as { player: PlayerStats }
          setPlayerStats(result.player)
          await refreshSharedData()
        }).catch(() => setApiStatus('offline'))
  }

  function nextQuestion() {
    setProgress((current) => ({
      ...current,
      current: pickQuestion(current.limit, current.asked, current.reviews, current.answered, factWeights, current.current),
    }))
    setAnswer('')
    setFeedback(null)
  }

  function startFresh() {
    setProgress({ ...newProgress(progress.limit), current: pickQuestion(progress.limit, [], [], 0, factWeights) })
    setAnswer('')
    setFeedback(null)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <form className="player-form" onSubmit={savePlayerName}>
          <label htmlFor="player-name">PLAYER</label>
          <input
            id="player-name"
            maxLength={20}
            onChange={(event) => setPlayerName(event.target.value)}
            value={playerName}
          />
          <button type="submit">Save</button>
        </form>
        <span className={`api-status ${apiStatus}`} role="status">
          {apiStatus === 'online' ? 'Online' : apiStatus === 'connecting' ? 'Connecting' : 'Offline'}
        </span>
        <button className="reset-button" type="button" onClick={startFresh} title="Start a fresh session">
          New session
        </button>
      </header>

      <div className="page-grid" id="home">
        <aside className="sidebar">
          <section className="range-section" aria-labelledby="range-title">
            <div className="section-label" id="range-title">Choose your tables</div>
            <div className="range-picker" role="group" aria-label="Multiplication table range">
              {RANGES.map((limit) => (
                <button
                  className={`range-option ${progress.limit === limit ? 'selected' : ''}`}
                  key={limit}
                  type="button"
                  aria-pressed={progress.limit === limit}
                  onClick={() => changeRange(limit)}
                >
                  <span className="range-number">{limit}</span>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="practice-area" aria-label="Multiplication practice">
          <div className="practice-heading">
            <div>
              <h2>Question <span>{String(questionNumber).padStart(2, '0')}</span></h2>
            </div>
            <div className="streak-chip">{progress.streak} streak</div>
          </div>

          <div className={`question-card ${feedback ? `is-${feedback}` : ''}`}>
            <div className="equation" aria-label={`${progress.current.left} times ${progress.current.right}`}>
              <span>{progress.current.left}</span><b>×</b><span>{progress.current.right}</span><b className="equals">=</b>
              <form className="answer-form" id="answer-form" onSubmit={submitAnswer}>
                <input
                  aria-label="Your answer"
                  autoComplete="off"
                  enterKeyHint={feedback ? 'next' : 'done'}
                  inputMode="numeric"
                  onChange={(event) => {
                    if (!feedback) setAnswer(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    event.preventDefault()
                    if (feedback) nextQuestion()
                    else event.currentTarget.form?.requestSubmit()
                  }}
                  placeholder="?"
                  ref={answerInputRef}
                  value={answer}
                />
              </form>
            </div>

            {feedback ? (
              <div className={`feedback-message ${feedback}`} role="status" aria-live="polite">
                <span className="feedback-icon" aria-hidden="true">{feedback === 'correct' ? '✓' : '↻'}</span>
                <span>{feedback === 'correct' ? 'Exactly right. Keep that rhythm!' : <>Not quite. <strong>{progress.current.left} × {progress.current.right} = {progress.current.left * progress.current.right}</strong> will come back for another go.</>}</span>
              </div>
            ) : null}

            <div className="card-bottom">
              <span className="keyboard-hint">ENTER TO {feedback ? 'CONTINUE' : 'CHECK'}</span>
              {feedback ? (
                <button className="primary-button" type="button" onClick={nextQuestion}>Next question</button>
              ) : (
                <button className="primary-button" type="submit" form="answer-form">Check answer</button>
              )}
            </div>
          </div>

          <div className="progress-heading">
            <h3>Your progress</h3>
          </div>

          <div className="stats-row">
            <div className="stat-block"><span className="stat-label">ANSWERED</span><span className="stat-value">{progress.answered}<small> questions</small></span></div>
            <div className="stat-block"><span className="stat-label">ACCURACY</span><span className="stat-value">{displayAccuracy}<small>%</small></span><div className="accuracy-track"><span style={{ width: `${displayAccuracy}%` }} /></div></div>
            <div className="stat-block"><span className="stat-label">TO REVISIT</span><span className="stat-value">{pendingCount}<small> facts</small></span></div>
          </div>

          <div className="practice-footer"><span>BEST STREAK {progress.bestStreak}</span></div>

          <section className="leaderboard" aria-labelledby="leaderboard-title">
            <div className="leaderboard-heading">
              <h3 id="leaderboard-title">Leaderboard</h3>
              <span>Top 10 · all time</span>
            </div>
            {leaderboard.length ? (
              <ol>
                {leaderboard.slice(0, 10).map((entry, index) => (
                  <li className={entry.name === player.name ? 'current-player' : ''} key={`${entry.name}-${index}`}>
                    <span className="rank">{index + 1}</span>
                    <span className="leader-name">{entry.name}</span>
                    <span className="leader-score">{entry.correct} correct</span>
                    <span className="leader-accuracy">{entry.accuracy}%</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="leaderboard-empty">
                {apiStatus === 'online' ? 'Answer a question to join the board.' : 'Leaderboard unavailable while offline.'}
              </p>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}

export default App
