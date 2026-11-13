import { describe, expect, it } from 'vitest'

import type { QuizSettings, ShowAnswers } from '@/features/survey-logic/types'
import { sharedCases } from '@/test/shared-cases'

import {
  attemptsLeft,
  passed,
  scoreAttempt,
  showAnswers,
  type ScorableQuestion,
  type Score,
} from './scoring'

interface Cases {
  questions: ScorableQuestion[]
  score: { name: string; visible: string[]; answers: Record<string, unknown>; expected: Score }[]
  passed: {
    name: string
    score: number | null
    pass_mark: number | null
    expected: boolean | null
  }[]
  attempts_left: {
    name: string
    rules: Pick<QuizSettings, 'retakes' | 'max_attempts'>
    used: number
    best_score: number | null
    passed: boolean | null
    expected: number | null
  }[]
  show_answers: {
    name: string
    show_answers: ShowAnswers
    passed: boolean | null
    attempts_left: number | null
    expected: boolean
  }[]
}

const CASES = sharedCases('scoring.json') as Cases

describe('scoreAttempt (shared cases)', () => {
  it.each(CASES.score)('$name', ({ visible, answers, expected }) => {
    expect(scoreAttempt(CASES.questions, answers, visible)).toEqual(expected)
  })
})

describe('passed (shared cases)', () => {
  it.each(CASES.passed)('$name', ({ score, pass_mark, expected }) => {
    expect(passed(score, pass_mark)).toBe(expected)
  })
})

describe('attemptsLeft (shared cases)', () => {
  it.each(CASES.attempts_left)('$name', ({ rules, used, best_score, passed: p, expected }) => {
    expect(attemptsLeft(rules, used, best_score, p)).toBe(expected)
  })
})

describe('showAnswers (shared cases)', () => {
  it.each(CASES.show_answers)('$name', ({ show_answers, passed: p, attempts_left, expected }) => {
    expect(showAnswers(show_answers, p, attempts_left)).toBe(expected)
  })
})
