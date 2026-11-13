/**
 * Trainings in the respondent form: the rules shown before starting, and Preview's own scoring
 * (real attempts are scored on the server; Preview has the draft's answer key, so it scores
 * locally with the same shared rules).
 */
import type { AttemptResult, ReviewItem, TrainingInfo } from '@/features/respond/api'
import { evaluate } from '@/features/survey-logic/conditions'
import { formatNumber } from '@/features/survey-logic/numbers'
import type {
  Answers,
  Draft,
  Question,
  QuizKey,
  QuizSettings,
  Retakes,
} from '@/features/survey-logic/types'

import { attemptsLeft, passed, quizKey, scoreAttempt, showAnswers } from './scoring'

export const DEFAULT_QUIZ: QuizSettings = {
  pass_mark: 80,
  show_pass_mark: true,
  show_score: true,
  show_answers: 'after_pass_or_last',
  retakes: 'limit',
  max_attempts: 3,
}

/** The fixed number of attempts, if there is one ("Attempt 2 of 3"). */
export function fixedAttempts(retakes: Retakes, maxAttempts: number): number | null {
  if (retakes === 'none') return 1
  return retakes === 'limit' ? maxAttempts : null
}

/** "Pass mark 80% · Attempt 2 of 3", shown under the cover before starting. */
export function introText(
  info: Pick<TrainingInfo, 'pass_mark' | 'retakes' | 'max_attempts' | 'attempts_used'>,
): string {
  const next = info.attempts_used + 1
  const total = fixedAttempts(info.retakes, info.max_attempts)
  const attempts =
    total === 1
      ? 'One attempt'
      : total !== null
        ? `Attempt ${String(next)} of ${String(total)}`
        : info.retakes === 'until_pass'
          ? `Attempt ${String(next)} · retake until you pass`
          : `Attempt ${String(next)} · retake until every answer is correct`
  return [info.pass_mark !== null ? `Pass mark ${String(info.pass_mark)}%` : null, attempts]
    .filter(Boolean)
    .join(' · ')
}

function shownAnswer(question: Question, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const labels = new Map(question.options.map((o) => [o.key, o.label]))
  if (question.type === 'multi' && Array.isArray(value)) {
    return value.map((k) => labels.get(k as string) ?? '').join(', ') || null
  }
  if (question.type === 'single' || question.type === 'dropdown') {
    return labels.get(value as string) ?? null
  }
  if (question.type === 'number' && typeof value === 'number') {
    return formatNumber(value, question.config.number_unit)
  }
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

/** The correct answer in words: option labels, or a number or range with its unit. */
export function correctAnswerText(question: Question, key: QuizKey): string {
  if (question.type === 'number') {
    const unit = question.config.number_unit
    const low = key.correct_min
    const high = key.correct_max
    if (low === null || low === undefined || high === null || high === undefined) return ''
    if (low === high) return formatNumber(low, unit)
    return `${formatNumber(low)} to ${formatNumber(high, unit)}`
  }
  const correct = new Set(key.correct_options ?? [])
  return question.options
    .filter((o) => correct.has(o.key))
    .map((o) => o.label)
    .join(', ')
}

export interface PreviewAttempts {
  used: number
  bestScore: number | null
  passed: boolean | null
}

export const NO_ATTEMPTS: PreviewAttempts = { used: 0, bestScore: null, passed: null }

/** Score a Preview attempt like the server would, and what the person would be shown. */
export function previewAttempt(
  draft: Pick<Draft, 'questions' | 'sections' | 'settings'>,
  answers: Answers,
  before: PreviewAttempts,
): { result: AttemptResult; after: PreviewAttempts } {
  const rules = draft.settings.quiz ?? DEFAULT_QUIZ
  const visible = evaluate(draft, answers).visibleQuestions
  const scored = scoreAttempt(draft.questions, answers, visible)
  const attemptPassed = passed(scored.score, rules.pass_mark)
  const better =
    before.used === 0 ||
    (scored.score !== null && (before.bestScore === null || scored.score > before.bestScore))
  const everPassed =
    before.passed === true || attemptPassed === true
      ? true
      : before.passed === false || attemptPassed === false
        ? false
        : null
  const after: PreviewAttempts = {
    used: before.used + 1,
    bestScore: better ? scored.score : before.bestScore,
    passed: everPassed,
  }
  const left = attemptsLeft(rules, after.used, after.bestScore, after.passed)
  let review: ReviewItem[] | null = null
  if (showAnswers(rules.show_answers, after.passed, left)) {
    review = draft.questions.flatMap((question) => {
      const key = quizKey(question)
      const right = scored.correct[question.key]
      if (!key || right === undefined) return []
      return [
        {
          question_key: question.key,
          text: question.text,
          correct: right,
          points: key.points || 1,
          your_answer: shownAnswer(question, answers[question.key]),
          correct_answer: correctAnswerText(question, key),
        },
      ]
    })
  }
  const show = rules.show_score
  return {
    result: {
      attempt_no: after.used,
      score: show ? scored.score : null,
      points: show ? scored.points : null,
      max_points: show ? scored.max_points : null,
      passed: show ? attemptPassed : null,
      pass_mark: show ? rules.pass_mark : null,
      attempts_used: after.used,
      attempts_left: left,
      review,
    },
    after,
  }
}
