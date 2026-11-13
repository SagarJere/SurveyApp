/**
 * Pure operations on a draft. Each returns a new draft and never mutates its input, so the
 * store can keep unchanged questions as the same objects (cards that didn't change don't
 * re-render).
 */
import {
  conditionOpsFor,
  eligibleSourcesForQuestion,
  eligibleSourcesForSection,
  TYPE_RULES,
} from '@/features/survey-logic/conditions'
import { DEFAULT_NUMBER_CONFIG } from '@/features/survey-logic/numbers'
import type {
  Condition,
  Draft,
  MoneyConfig,
  NumberConfig,
  Option,
  Question,
  QuestionType,
  Section,
} from '@/features/survey-logic/types'

export const newKey = (): string => crypto.randomUUID()

export const DEFAULT_MONEY_CONFIG: MoneyConfig = {
  currency: 'INR',
  min: null,
  max: null,
  decimals: false,
}

/** Starting settings for a number question; the lowest value 0 gives phones the number pad. */
export { DEFAULT_NUMBER_CONFIG }

/** Default value when a money condition is added (docs/05-survey-builder.md). */
export const DEFAULT_MONEY_CONDITION = 50_000

export function newOption(label = ''): Option {
  return { key: newKey(), label }
}

export function newQuestion(type: QuestionType, sectionKey: string): Question {
  return {
    key: newKey(),
    section_key: sectionKey,
    type,
    text: '',
    help: '',
    required: false,
    options: TYPE_RULES[type].hasOptions ? [newOption('Option 1'), newOption('Option 2')] : [],
    config:
      type === 'money'
        ? { ...DEFAULT_MONEY_CONFIG }
        : type === 'number'
          ? { ...DEFAULT_NUMBER_CONFIG }
          : {},
    condition: null,
  }
}

export function newSection(title = ''): Section {
  return { key: newKey(), title, description: '', condition: null }
}

/** Keep questions grouped by section, in section order (the stored order rule). */
export function normalize(draft: Draft): Draft {
  const bySection = new Map<string, Question[]>(draft.sections.map((s) => [s.key, []]))
  for (const q of draft.questions) bySection.get(q.section_key)?.push(q)
  const questions = draft.sections.flatMap((s) => bySection.get(s.key) ?? [])
  const unchanged =
    questions.length === draft.questions.length &&
    questions.every((q, i) => q === draft.questions[i])
  return unchanged ? draft : { ...draft, questions }
}

function mapQuestion(draft: Draft, key: string, update: (q: Question) => Question): Draft {
  return { ...draft, questions: draft.questions.map((q) => (q.key === key ? update(q) : q)) }
}

function mapSection(draft: Draft, key: string, update: (s: Section) => Section): Draft {
  return { ...draft, sections: draft.sections.map((s) => (s.key === key ? update(s) : s)) }
}

export function addQuestion(
  draft: Draft,
  type: QuestionType,
  sectionKey: string,
): [Draft, Question] {
  const question = newQuestion(type, sectionKey)
  return [normalize({ ...draft, questions: [...draft.questions, question] }), question]
}

export type QuestionPatch = Partial<Pick<Question, 'text' | 'help' | 'required' | 'quiz'>>

export function updateQuestion(draft: Draft, key: string, patch: QuestionPatch): Draft {
  return mapQuestion(draft, key, (q) => ({ ...q, ...patch }))
}

/** Change type, keeping options and money or number settings so changing back restores them. */
export function changeType(draft: Draft, key: string, type: QuestionType): Draft {
  return mapQuestion(draft, key, (q) => {
    if (q.type === type) return q
    const options =
      TYPE_RULES[type].hasOptions && q.options.length === 0
        ? [newOption('Option 1'), newOption('Option 2')]
        : q.options
    let config = q.config
    if (type === 'money' && q.config.currency === undefined) {
      config = { ...q.config, ...DEFAULT_MONEY_CONFIG }
    } else if (type === 'number' && q.config.number_decimals === undefined) {
      config = { ...q.config, ...DEFAULT_NUMBER_CONFIG }
    }
    return { ...q, type, options, config }
  })
}

export function updateNumberConfig(draft: Draft, key: string, patch: Partial<NumberConfig>): Draft {
  return mapQuestion(draft, key, (q) => ({
    ...q,
    config: { ...DEFAULT_NUMBER_CONFIG, ...q.config, ...patch },
  }))
}

export function updateMoneyConfig(draft: Draft, key: string, patch: Partial<MoneyConfig>): Draft {
  return mapQuestion(draft, key, (q) => ({
    ...q,
    config: { ...DEFAULT_MONEY_CONFIG, ...q.config, ...patch },
  }))
}

export function addOption(draft: Draft, key: string): [Draft, Option] {
  const option = newOption()
  return [mapQuestion(draft, key, (q) => ({ ...q, options: [...q.options, option] })), option]
}

export function updateOption(draft: Draft, key: string, optionKey: string, label: string): Draft {
  return mapQuestion(draft, key, (q) => ({
    ...q,
    options: q.options.map((o) => (o.key === optionKey ? { ...o, label } : o)),
  }))
}

/** Remove an option. The last remaining option can't be removed. */
export function removeOption(draft: Draft, key: string, optionKey: string): Draft {
  return mapQuestion(draft, key, (q) =>
    q.options.length <= 1
      ? q
      : {
          ...q,
          options: q.options.filter((o) => o.key !== optionKey),
          // A removed option can't stay a correct answer.
          ...(q.quiz?.correct_options
            ? {
                quiz: {
                  ...q.quiz,
                  correct_options: q.quiz.correct_options.filter((k) => k !== optionKey),
                },
              }
            : {}),
        },
  )
}

/**
 * Move a question up or down one place. At the first/last question of a section it moves into
 * the previous/next section instead (to that section's end/start).
 */
export function moveQuestion(draft: Draft, key: string, direction: -1 | 1): Draft {
  const question = draft.questions.find((q) => q.key === key)
  if (!question) return draft
  const inSection = draft.questions.filter((q) => q.section_key === question.section_key)
  const positionInSection = inSection.indexOf(question)
  const atEdge =
    direction < 0 ? positionInSection === 0 : positionInSection === inSection.length - 1

  if (atEdge) {
    const sectionIndex = draft.sections.findIndex((s) => s.key === question.section_key)
    const target = draft.sections[sectionIndex + direction]
    if (!target) return draft
    const moved = { ...question, section_key: target.key }
    const rest = draft.questions.filter((q) => q.key !== key)
    // Moving up goes to the end of the previous section; moving down to the start of the next.
    // normalize() then places it correctly even when the target section is empty.
    const questions = direction < 0 ? placeLast(rest, moved) : placeFirst(rest, moved)
    return normalize({ ...draft, questions })
  }

  const index = draft.questions.indexOf(question)
  const swapWith = index + direction
  const questions = [...draft.questions]
  const other = questions[swapWith]
  if (!other) return draft
  questions[swapWith] = question
  questions[index] = other
  return { ...draft, questions }
}

function placeLast(rest: Question[], moved: Question): Question[] {
  const lastIndex = rest.map((q) => q.section_key).lastIndexOf(moved.section_key)
  const at = lastIndex === -1 ? rest.length : lastIndex + 1
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

function placeFirst(rest: Question[], moved: Question): Question[] {
  const firstIndex = rest.findIndex((q) => q.section_key === moved.section_key)
  const at = firstIndex === -1 ? rest.length : firstIndex
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** Insert a copy below, with new keys for the question and its options, text + " (copy)". */
export function duplicateQuestion(draft: Draft, key: string): [Draft, Question | null] {
  const index = draft.questions.findIndex((q) => q.key === key)
  const source = draft.questions[index]
  if (!source) return [draft, null]
  const optionKeys = new Map(source.options.map((o) => [o.key, newKey()]))
  const copy: Question = {
    ...source,
    key: newKey(),
    text: source.text ? `${source.text} (copy)` : '',
    options: source.options.map((o) => ({ ...o, key: optionKeys.get(o.key) ?? newKey() })),
    config: { ...source.config },
    condition: source.condition ? { ...source.condition } : null,
  }
  if (source.quiz) {
    // The copy's correct answers point at its own new options.
    copy.quiz = {
      ...source.quiz,
      correct_options: (source.quiz.correct_options ?? []).flatMap((k) => {
        const mapped = optionKeys.get(k)
        return mapped ? [mapped] : []
      }),
    }
  }
  const questions = [...draft.questions]
  questions.splice(index + 1, 0, copy)
  return [{ ...draft, questions }, copy]
}

export interface DeletedQuestion {
  question: Question
  index: number
}

export function deleteQuestion(draft: Draft, key: string): [Draft, DeletedQuestion | null] {
  const index = draft.questions.findIndex((q) => q.key === key)
  const question = draft.questions[index]
  if (!question) return [draft, null]
  return [
    { ...draft, questions: draft.questions.filter((q) => q.key !== key) },
    { question, index },
  ]
}

/** Put a deleted question back where it was (or into the first section if its section is gone). */
export function restoreQuestion(draft: Draft, deleted: DeletedQuestion): Draft {
  if (draft.questions.some((q) => q.key === deleted.question.key)) return draft
  const sectionExists = draft.sections.some((s) => s.key === deleted.question.section_key)
  const firstSection = draft.sections[0]
  const question =
    sectionExists || !firstSection
      ? deleted.question
      : { ...deleted.question, section_key: firstSection.key }
  const questions = [...draft.questions]
  questions.splice(Math.min(deleted.index, questions.length), 0, question)
  return normalize({ ...draft, questions })
}

/** Add a section at the end. Adding the second section titles the first "Section 1". */
export function addSection(draft: Draft): [Draft, Section] {
  const section = newSection()
  const sections = draft.sections.map((s, i) =>
    draft.sections.length === 1 && i === 0 && !s.title.trim() ? { ...s, title: 'Section 1' } : s,
  )
  return [{ ...draft, sections: [...sections, section] }, section]
}

export type SectionPatch = Partial<Pick<Section, 'title' | 'description' | 'video'>>

export function updateSection(draft: Draft, key: string, patch: SectionPatch): Draft {
  return mapSection(draft, key, (s) => ({ ...s, ...patch }))
}

export function moveSection(draft: Draft, key: string, direction: -1 | 1): Draft {
  const index = draft.sections.findIndex((s) => s.key === key)
  const target = index + direction
  const section = draft.sections[index]
  const other = draft.sections[target]
  if (!section || !other) return draft
  const sections = [...draft.sections]
  sections[target] = section
  sections[index] = other
  return normalize({ ...draft, sections })
}

export interface DeletedSection {
  section: Section
  movedTo: Section
  movedCount: number
}

/**
 * Delete a section. Its questions move to the previous section (or the next one if it was
 * first). The last section can't be deleted.
 */
export function deleteSection(draft: Draft, key: string): [Draft, DeletedSection | null] {
  const index = draft.sections.findIndex((s) => s.key === key)
  const section = draft.sections[index]
  const movedTo = draft.sections[index > 0 ? index - 1 : 1]
  if (!section || !movedTo || draft.sections.length < 2) return [draft, null]
  let movedCount = 0
  const questions = draft.questions.map((q) => {
    if (q.section_key !== key) return q
    movedCount += 1
    return { ...q, section_key: movedTo.key }
  })
  const sections = draft.sections.filter((s) => s.key !== key)
  // Moved questions go to the end of the previous section (or the start of the next).
  const next = normalize({ ...draft, sections, questions })
  return [next, { section, movedTo, movedCount }]
}

/** The condition a new "Add condition" starts with: nearest earlier eligible question. */
export function defaultCondition(
  draft: Draft,
  target: { question: string } | { section: string },
): Condition | null {
  const sources =
    'question' in target
      ? eligibleSourcesForQuestion(draft, target.question)
      : eligibleSourcesForSection(draft, target.section)
  const source = sources.at(-1)
  return source ? conditionFor(source) : null
}

/** A fresh condition on this source: its first operator and first value. */
export function conditionFor(source: Question): Condition {
  const op = conditionOpsFor(source.type)[0] ?? 'is'
  let val: Condition['val']
  if (source.type === 'money') val = DEFAULT_MONEY_CONDITION
  else if (source.type === 'rating') val = 1
  else if (source.type === 'number') val = 1
  else val = source.options[0]?.key ?? null
  return { src: source.key, op, val }
}

export type ConditionTarget = { kind: 'question'; key: string } | { kind: 'section'; key: string }

export function setCondition(
  draft: Draft,
  target: ConditionTarget,
  condition: Condition | null,
): Draft {
  return target.kind === 'question'
    ? mapQuestion(draft, target.key, (q) => ({ ...q, condition }))
    : mapSection(draft, target.key, (s) => ({ ...s, condition }))
}

export function setTitle(draft: Draft, title: string): Draft {
  return { ...draft, title }
}

export function setDescription(draft: Draft, description: string): Draft {
  return { ...draft, description }
}
