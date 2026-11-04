import type { QuestionResult, QuestionsResult } from './api'
import { whole } from './format'

type Condition = NonNullable<QuestionResult['condition']>

const OPS: Record<string, string> = {
  is: 'answered',
  not: "didn't answer",
  gte: 'answered at least',
  lte: 'answered at most',
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
  const verb = OPS[condition.op] ?? 'answered'
  const subject = source ? `Q${String(source.number)}` : 'an earlier question'
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
