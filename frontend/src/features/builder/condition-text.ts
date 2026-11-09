/** Words for conditions: tags on cards and explanations of broken conditions. */
import type { ConditionProblem } from '@/features/survey-logic/conditions'
import { formatAmount } from '@/features/survey-logic/money'
import { formatNumber } from '@/features/survey-logic/numbers'
import type { Condition, ConditionOp, Currency, Draft } from '@/features/survey-logic/types'

export const OP_LABELS: Record<ConditionOp, string> = {
  is: 'is',
  not: 'is not',
  gte: 'is at least',
  lte: 'is at most',
}

/** "Shown when Q2 is “Hybrid”" · "Shown when Q1 is at least 4" · "… is at least ₹50,000". */
export function conditionSummary(draft: Draft, condition: Condition): string {
  const index = draft.questions.findIndex((q) => q.key === condition.src)
  const source = draft.questions[index]
  if (!source) return ''
  const prefix = `Shown when Q${index + 1} ${OP_LABELS[condition.op]}`
  if (source.type === 'money') {
    const currency: Currency = source.config.currency ?? 'INR'
    return typeof condition.val === 'number'
      ? `${prefix} ${formatAmount(condition.val, currency)}`
      : prefix
  }
  if (source.type === 'number') {
    return typeof condition.val === 'number'
      ? `${prefix} ${formatNumber(condition.val, source.config.number_unit)}`
      : prefix
  }
  if (source.type === 'rating') return `${prefix} ${String(condition.val ?? '')}`
  const option = source.options.find((o) => o.key === condition.val)
  const label = option?.label.trim() ?? ''
  return `${prefix} “${label.length > 0 ? label : 'Untitled option'}”`
}

/** The explanation shown in a broken condition's panel (docs/05-survey-builder.md). */
export function problemMessage(
  draft: Draft,
  condition: Condition,
  problem: ConditionProblem,
): string {
  const n = draft.questions.findIndex((q) => q.key === condition.src) + 1
  switch (problem) {
    case 'source_missing':
      return 'The question this depended on was deleted. Pick a new one or remove the condition.'
    case 'source_after':
      return `Q${n} now comes after this question. Move it back up or change the condition.`
    case 'source_not_earlier_section':
      return `Q${n} is in this section or a later one. Move it to an earlier section or change the condition.`
    case 'source_ineligible':
      return `Q${n} can no longer be used in a condition (it's now a text question). Set the condition again.`
    case 'answer_changed':
      return `The answer this condition uses changed in Q${n}. Pick it again.`
  }
}
