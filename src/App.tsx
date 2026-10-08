import { useEffect, useRef, useState } from 'react'
import './App.css'

type Fact = { left: number; right: number }
type Review = Fact & { dueAt: number; misses: number }
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

function pickQuestion(limit: number, asked: string[], reviews: Review[], answered: number): Fact {
  const dueReviews = reviews.filter((fact) => fact.dueAt <= answered)
  if (dueReviews.length) {
    const review = dueReviews[Math.floor(Math.random() * dueReviews.length)]
    return { left: review.left, right: review.right }
  }

  const unseen = makeFactPool(limit).filter((fact) => !asked.includes(factKey(fact)))
  const choices = unseen.length ? unseen : makeFactPool(limit)
  return choices[Math.floor(Math.random() * choices.length)]
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

function App() {
  const [progress, setProgress] = useState<SavedProgress>(loadProgress)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null)
  const answerInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  }, [progress])

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
        current: pickQuestion(current.limit, current.asked, current.reviews, current.answered),
      }))
      setAnswer('')
      setFeedback(null)
    }

    window.addEventListener('keydown', handleContinue)
    return () => window.removeEventListener('keydown', handleContinue)
  }, [feedback])

  const pendingCount = progress.reviews.length
  const accuracy = progress.answered ? Math.round((progress.correct / progress.answered) * 100) : 0
  const questionNumber = progress.answered + 1

  function changeRange(limit: number) {
    if (limit !== progress.limit) {
      setProgress(newProgress(limit))
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
  }

  function nextQuestion() {
    setProgress((current) => ({
      ...current,
      current: pickQuestion(current.limit, current.asked, current.reviews, current.answered),
    }))
    setAnswer('')
    setFeedback(null)
  }

  function startFresh() {
    setProgress(newProgress(progress.limit))
    setAnswer('')
    setFeedback(null)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-meta">YOUR PRACTICE ROOM</div>
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
                  <span className="range-caption">{limit === 5 ? 'Easy start' : limit === 10 ? 'Going further' : 'Full stretch'}</span>
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
            <div className="question-topline"><span>WHAT'S THE ANSWER?</span><span>{progress.limit} TABLES</span></div>
            <div className="equation" aria-label={`${progress.current.left} times ${progress.current.right}`}>
              <span>{progress.current.left}</span><b>×</b><span>{progress.current.right}</span><b className="equals">=</b>
              <form className="answer-form" id="answer-form" onSubmit={submitAnswer}>
                <input
                  aria-label="Your answer"
                  autoComplete="off"
                  disabled={feedback !== null}
                  inputMode="numeric"
                  onChange={(event) => setAnswer(event.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
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
            ) : (
              <p className="question-hint">Take a breath. You know this one.</p>
            )}

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
            <div className="stat-block"><span className="stat-label">ACCURACY</span><span className="stat-value">{accuracy}<small>%</small></span><div className="accuracy-track"><span style={{ width: `${accuracy}%` }} /></div></div>
            <div className="stat-block"><span className="stat-label">TO REVISIT</span><span className="stat-value">{pendingCount}<small> facts</small></span></div>
          </div>

          <div className="practice-footer"><span>BEST STREAK {progress.bestStreak}</span></div>
        </section>
      </div>
    </main>
  )
}

export default App
