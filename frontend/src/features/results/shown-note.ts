import { formatAmount } from '@/features/survey-logic/money'
import { formatNumber } from '@/features/survey-logic/numbers'
import type { Currency } from '@/features/survey-logic/types'

import type { QuestionResult, QuestionsResult } from './api'
import { whole } from './format'

type Condition = NonNullable<QuestionResult['condition']>

const CHOICE_VERBS: Record<string, string> = { is: 'answered', not: "didn't answer" }
const NUMBER_VERBS: Record<string, string> = {
  gte: 'answered at least',
  lte: 'answered at most',
  gt: 'answered more than',
  lt: 'answered less than',
  is: 'answered exactly',
  not: "didn't answer",
}
const NUMERIC_TYPES = new Set(['rating', 'money', 'number'])

function numberText(source: QuestionResult | undefined, value: number): string {
  if (source?.type === 'money') return formatAmount(value, (source.currency ?? 'INR') as Currency)
  if (source?.type === 'number') return formatNumber(value, source.unit)
  return formatNumber(value)
}

export function questionIndex(result: QuestionsResult): Map<string, QuestionResult> {
  return new Map(result.sections.flatMap((s) => s.questions).map((q) => [q.key, q]))
}

/** "people who answered “Where do you work?” with “Remote”" */
export function conditionText(
  condition: Condition,
  questions: Map<string, QuestionResult>,
): string {
  const source = questions.get(condition.src)
  const label =
    source?.options?.find((o) => o.key === condition.val)?.label ??
    (typeof condition.val === 'number' || typeof condition.val === 'string'
      ? String(condition.val)
      : '')
  const subject = source ? `Q${String(source.number)}` : 'an earlier question'
  if (source && NUMERIC_TYPES.has(source.type) && typeof condition.val === 'number') {
    const verb = NUMBER_VERBS[condition.op] ?? 'answered'
    return `people who ${verb} ${numberText(source, condition.val)} to ${subject}`
  }
  const verb = CHOICE_VERBS[condition.op] ?? 'answered'
  return `people who ${verb} “${label}” to ${subject}`
}

/** The line under each question card saying who saw it (the denominator for every %). */
export function shownNote(
  question: QuestionResult,
  questions: Map<string, QuestionResult>,
  sectionCondition: Condition | null,
): string {
  const people = `${whole(question.shown)} ${question.shown === 1 ? 'person' : 'people'}`
  const condition = question.condition ?? sectionCondition
  if (condition) return `Only shown to ${conditionText(condition, questions)}: ${people}.`
  return `Shown to ${people}.`
}
