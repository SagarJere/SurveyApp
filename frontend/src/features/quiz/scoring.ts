/**
 * Training quiz rules (docs/09-trainings.md, "Quiz and scoring").
 * Mirrors backend/app/services/scoring.py; both pass shared/test-cases/scoring.json.
 *
 * The server scores every real attempt. The builder uses these for Preview's score screen.
 */
import type {
  QuestionType,
  QuizKey,
  QuizSettings,
  ShowAnswers,
} from '@/features/survey-logic/types'

/** Question types HR can mark with a correct answer. Others collect feedback only. */
export const MARKABLE_TYPES: ReadonlySet<QuestionType> = new Set([
  'single',
  'dropdown',
  'multi',
  'number',
])
const PERFECT = 100

export interface ScorableQuestion {
  key: string
  type: QuestionType
  quiz?: QuizKey | null
}

/** The question's answer key, or null when it isn't marked (or its type can't be). */
export function quizKey(question: ScorableQuestion): QuizKey | null {
  if (!question.quiz || !MARKABLE_TYPES.has(question.type)) return null
  return question.quiz
}

function hundredths(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null
}

/**
 * Choice: the right option. Checkboxes: exactly the right boxes, no part marks.
 * Number: inside the accepted range (an exact value is min = max), limits included.
 */
export function isCorrect(question: ScorableQuestion, key: QuizKey, answer: unknown): boolean {
  const correct = new Set(key.correct_options ?? [])
  if (question.type === 'single' || question.type === 'dropdown') {
    return typeof answer === 'string' && correct.has(answer)
  }
  if (question.type === 'multi') {
    if (!Array.isArray(answer) || answer.length === 0) return false
    const chosen = new Set(answer)
    return chosen.size === correct.size && [...chosen].every((k) => correct.has(k as string))
  }
  const value = hundredths(answer)
  if (value === null) return false
  const low = hundredths(key.correct_min)
  const high = hundredths(key.correct_max)
  return (low === null || value >= low) && (high === null || value <= high)
}

/** points / maxPoints as a whole %, halves rounded up (12.5 → 13). */
export function wholePercent(points: number, maxPoints: number): number | null {
  if (maxPoints <= 0) return null
  return Math.floor((200 * points + maxPoints) / (2 * maxPoints))
}

export interface Score {
  points: number
  max_points: number
  /** Null when nothing marked was shown. */
  score: number | null
  /** Marked, shown questions only. */
  correct: Record<string, boolean>
}

/** Points earned and available to this person. Hidden questions don't count. */
export function scoreAttempt(
  questions: readonly ScorableQuestion[],
  answers: Readonly<Record<string, unknown>>,
  visible: Iterable<string>,
): Score {
  const shown = new Set(visible)
  let points = 0
  let maxPoints = 0
  const correct: Record<string, boolean> = {}
  for (const question of questions) {
    const key = quizKey(question)
    if (!key || !shown.has(question.key)) continue
    const worth = key.points || 1
    const right = isCorrect(question, key, answers[question.key])
    correct[question.key] = right
    maxPoints += worth
    if (right) points += worth
  }
  return { points, max_points: maxPoints, score: wholePercent(points, maxPoints), correct }
}

/** Against the pass mark; null when there's no pass mark or nothing to score. */
export function passed(score: number | null, passMark: number | null): boolean | null {
  if (score === null || passMark === null) return null
  return score >= passMark
}

/**
 * Attempts still allowed; null means no limit. Passing ends the attempts (except "until
 * perfect", which goes on to 100%), a perfect score always ends them, and a training with
 * nothing to score needs only one attempt.
 */
export function attemptsLeft(
  rules: Pick<QuizSettings, 'retakes' | 'max_attempts'>,
  used: number,
  bestScore: number | null,
  hasPassed: boolean | null,
): number | null {
  if (used > 0 && (bestScore === null || bestScore >= PERFECT)) return 0
  if (rules.retakes === 'until_perfect') return null
  if (used > 0 && hasPassed) return 0
  if (rules.retakes === 'until_pass') return null
  const total = rules.retakes === 'limit' ? rules.max_attempts || 1 : 1
  return Math.max(0, total - used)
}

/** Whether the correct answers may be shown now (the creator's rule). */
export function showAnswers(
  rule: ShowAnswers,
  hasPassed: boolean | null,
  left: number | null,
): boolean {
  if (rule === 'always') return true
  if (rule === 'never') return false
  return Boolean(hasPassed) || left === 0
}
