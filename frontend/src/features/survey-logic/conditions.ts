/**
 * Condition rules shared with backend/app/services/survey_logic.py.
 * Both must pass every case in shared/test-cases/survey-logic.json.
 */
import { MAX_AMOUNT } from './money'
import type { Answers, Condition, ConditionOp, Draft, Question, QuestionType } from './types'

export type ConditionProblem =
  | 'source_missing'
  | 'source_after'
  | 'source_not_earlier_section'
  | 'source_ineligible'
  | 'answer_changed'

interface TypeRules {
  hasOptions: boolean
  /** Empty when the type can't be a condition source. */
  conditionOps: readonly ConditionOp[]
}

export const TYPE_RULES: Record<QuestionType, TypeRules> = {
  single: { hasOptions: true, conditionOps: ['is', 'not'] },
  multi: { hasOptions: true, conditionOps: ['is', 'not'] },
  dropdown: { hasOptions: true, conditionOps: ['is', 'not'] },
  rating: { hasOptions: false, conditionOps: ['gte', 'lte'] },
  short: { hasOptions: false, conditionOps: [] },
  long: { hasOptions: false, conditionOps: [] },
  money: { hasOptions: false, conditionOps: ['gte', 'lte'] },
}

export const RATING_VALUES = [1, 2, 3, 4, 5] as const

/** Shapes the case files use: the draft's sections and questions, other fields optional. */
export interface LogicQuestion {
  key: string
  section_key: string
  type: string
  text?: string
  required?: boolean
  options?: { key: string; label: string }[]
  config?: Record<string, unknown>
  condition?: Condition | null
}
export interface LogicSection {
  key: string
  condition?: Condition | null
}
export interface LogicDraft {
  sections: LogicSection[]
  questions: LogicQuestion[]
  settings?: { opens_at?: string | null; closes_at?: string | null }
}

export function isAnswered(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim() !== ''
  if (Array.isArray(value)) return value.length > 0
  return true
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function rulesFor(type: string): TypeRules | undefined {
  return (TYPE_RULES as Record<string, TypeRules | undefined>)[type]
}

export function isEligibleSource(question: Pick<LogicQuestion, 'type'>): boolean {
  return (rulesFor(question.type)?.conditionOps.length ?? 0) > 0
}

export function conditionOpsFor(type: string): readonly ConditionOp[] {
  return rulesFor(type)?.conditionOps ?? []
}

function valueFits(source: LogicQuestion, op: string, val: unknown): boolean {
  const rules = rulesFor(source.type)
  if (!rules || !(rules.conditionOps as readonly string[]).includes(op)) return false
  if (rules.hasOptions) {
    return typeof val === 'string' && (source.options ?? []).some((o) => o.key === val)
  }
  if (source.type === 'rating') {
    return isNumber(val) && (RATING_VALUES as readonly number[]).includes(val)
  }
  return isNumber(val) && val >= 0 && val <= MAX_AMOUNT
}

class DraftIndex {
  readonly questionPos = new Map<string, number>()
  readonly sectionPos = new Map<string, number>()
  readonly questions = new Map<string, LogicQuestion>()

  constructor(draft: LogicDraft) {
    draft.questions.forEach((q, i) => {
      this.questionPos.set(q.key, i)
      this.questions.set(q.key, q)
    })
    draft.sections.forEach((s, i) => this.sectionPos.set(s.key, i))
  }

  problem(
    condition: Condition,
    where: { questionPos: number } | { sectionPos: number },
  ): ConditionProblem | null {
    const source = this.questions.get(condition.src)
    if (!source) return 'source_missing'
    if ('questionPos' in where && (this.questionPos.get(source.key) ?? -1) >= where.questionPos) {
      return 'source_after'
    }
    if (
      'sectionPos' in where &&
      (this.sectionPos.get(source.section_key) ?? -1) >= where.sectionPos
    ) {
      return 'source_not_earlier_section'
    }
    if (!isEligibleSource(source)) return 'source_ineligible'
    if (!valueFits(source, condition.op, condition.val)) return 'answer_changed'
    return null
  }
}

export function questionConditionProblem(draft: LogicDraft, key: string): ConditionProblem | null {
  const index = new DraftIndex(draft)
  const question = index.questions.get(key)
  if (!question?.condition) return null
  return index.problem(question.condition, { questionPos: index.questionPos.get(key) ?? 0 })
}

export function sectionConditionProblem(draft: LogicDraft, key: string): ConditionProblem | null {
  const index = new DraftIndex(draft)
  const section = draft.sections.find((s) => s.key === key)
  if (!section?.condition) return null
  return index.problem(section.condition, { sectionPos: index.sectionPos.get(key) ?? 0 })
}

function matches(source: LogicQuestion, condition: Condition, answers: Answers): boolean {
  const answer = answers[source.key]
  if (!isAnswered(answer)) return false // "is not" is also false when unanswered
  if (source.type === 'rating' || source.type === 'money') {
    if (!isNumber(answer) || !isNumber(condition.val)) return false
    return condition.op === 'gte' ? answer >= condition.val : answer <= condition.val
  }
  const hit = Array.isArray(answer) ? answer.includes(condition.val) : answer === condition.val
  return condition.op === 'is' ? hit : !hit
}

export interface Visibility {
  visibleSections: string[]
  visibleQuestions: string[]
  /** Answers to visible questions only; everything else is discarded. */
  keptAnswers: Answers
  /** Visible required questions without an answer. */
  missingRequired: string[]
}

/**
 * Which sections and questions are shown. Evaluated in display order, so a hidden source hides
 * everything that depends on it. Broken conditions fail open (the item shows).
 */
export function evaluate(draft: LogicDraft, answers: Answers): Visibility {
  const index = new DraftIndex(draft)
  const visible = new Set<string>()
  const kept: Answers = {}
  const sectionShown = new Map<string, boolean>()
  const sections = new Map(draft.sections.map((s) => [s.key, s]))

  const holds = (
    condition: Condition | null | undefined,
    where: { questionPos: number } | { sectionPos: number },
  ): boolean => {
    if (!condition) return true
    if (index.problem(condition, where)) return true
    const source = index.questions.get(condition.src)
    return !!source && visible.has(source.key) && matches(source, condition, kept)
  }

  const visibleSections: string[] = []
  const visibleQuestions: string[] = []
  const missingRequired: string[] = []

  draft.questions.forEach((question, position) => {
    const sectionKey = question.section_key
    if (!sectionShown.has(sectionKey)) {
      const shown = holds(sections.get(sectionKey)?.condition, {
        sectionPos: index.sectionPos.get(sectionKey) ?? 0,
      })
      sectionShown.set(sectionKey, shown)
      if (shown) visibleSections.push(sectionKey)
    }
    if (!sectionShown.get(sectionKey)) return
    if (!holds(question.condition, { questionPos: position })) return
    visible.add(question.key)
    visibleQuestions.push(question.key)
    if (isAnswered(answers[question.key])) kept[question.key] = answers[question.key]
    else if (question.required) missingRequired.push(question.key)
  })

  for (const section of draft.sections) {
    if (
      !sectionShown.has(section.key) &&
      holds(section.condition, { sectionPos: index.sectionPos.get(section.key) ?? 0 })
    ) {
      visibleSections.push(section.key)
    }
  }
  visibleSections.sort((a, b) => (index.sectionPos.get(a) ?? 0) - (index.sectionPos.get(b) ?? 0))

  return { visibleSections, visibleQuestions, keptAnswers: kept, missingRequired }
}

/** Questions that could be a condition source for this question: earlier and eligible. */
export function eligibleSourcesForQuestion(draft: Draft, questionKey: string): Question[] {
  const position = draft.questions.findIndex((q) => q.key === questionKey)
  return draft.questions.slice(0, Math.max(position, 0)).filter(isEligibleSource)
}

/** Questions that could be a condition source for this section: in earlier sections, eligible. */
export function eligibleSourcesForSection(draft: Draft, sectionKey: string): Question[] {
  const position = draft.sections.findIndex((s) => s.key === sectionKey)
  const earlier = new Set(draft.sections.slice(0, Math.max(position, 0)).map((s) => s.key))
  return draft.questions.filter((q) => earlier.has(q.section_key) && isEligibleSource(q))
}

/** How many questions and sections have a condition that points at this question. */
export function countDependents(draft: Draft, questionKey: string): number {
  return [...draft.questions, ...draft.sections].filter(
    (item) => item.condition?.src === questionKey,
  ).length
}
