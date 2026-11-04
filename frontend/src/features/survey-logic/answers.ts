/**
 * Per-question answer checks for the respondent form. The backend repeats these on submit
 * (Phase 4); the shared visibility rules live in conditions.ts.
 */
import { isAnswered } from './conditions'
import { formatAmount } from './money'
import type { Currency, Question } from './types'

export const TEXT_LIMITS = { short: 2000, long: 10_000 } as const

/** "Enter ₹5,00,000 or less." / "Enter at least ₹1,000." — or null when in range. */
export function moneyRangeError(question: Question, value: unknown): string | null {
  if (question.type !== 'money' || typeof value !== 'number') return null
  const currency: Currency = question.config.currency ?? 'INR'
  const { min, max } = question.config
  if (typeof min === 'number' && value < min)
    return `Enter at least ${formatAmount(min, currency)}.`
  if (typeof max === 'number' && value > max) return `Enter ${formatAmount(max, currency)} or less.`
  return null
}

export type AnswerProblem = 'required' | 'range'

/** Why this visible question stops the person moving on, if it does. */
export function answerProblem(question: Question, answer: unknown): AnswerProblem | null {
  if (moneyRangeError(question, answer)) return 'range'
  if (question.required && !isAnswered(answer)) return 'required'
  return null
}
