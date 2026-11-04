/**
 * Publish validation, shared with backend/app/services/survey_logic.py (validate_draft).
 * The server is the authority; the builder uses this for instant feedback.
 */
import {
  questionConditionProblem,
  sectionConditionProblem,
  TYPE_RULES,
  type ConditionProblem,
  type LogicDraft,
} from './conditions'

export type IssueCode =
  | 'no_questions'
  | 'question_text_missing'
  | 'options_too_few'
  | 'options_empty'
  | 'options_duplicate'
  | 'money_range'
  | 'condition_broken'
  | 'dates_order'
  /** Server-only: a theme image no longer exists (needs the database). */
  | 'theme_image_missing'

export interface Issue {
  code: IssueCode
  message: string
  question_key: string | null
  section_key: string | null
  problem: ConditionProblem | null
}

function issue(
  code: IssueCode,
  message: string,
  keys: { question?: string; section?: string; problem?: ConditionProblem } = {},
): Issue {
  return {
    code,
    message,
    question_key: keys.question ?? null,
    section_key: keys.section ?? null,
    problem: keys.problem ?? null,
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function hasOptions(type: string): boolean {
  return (
    (TYPE_RULES as Record<string, { hasOptions: boolean } | undefined>)[type]?.hasOptions ?? false
  )
}

export function validateDraft(draft: LogicDraft): Issue[] {
  const issues: Issue[] = []

  draft.questions.forEach((question, position) => {
    const n = position + 1
    const key = question.key
    if (!(question.text ?? '').trim()) {
      issues.push(issue('question_text_missing', `Q${n} has no question text.`, { question: key }))
    }
    if (hasOptions(question.type)) {
      const labels = (question.options ?? []).map((o) => o.label.trim())
      if (labels.length < 2) {
        issues.push(
          issue('options_too_few', `Q${n} needs at least two options.`, { question: key }),
        )
      }
      if (labels.some((label) => !label)) {
        issues.push(
          issue('options_empty', `Q${n} has an empty option. Fill it in or remove it.`, {
            question: key,
          }),
        )
      }
      const filled = labels.filter(Boolean).map((label) => label.toLocaleLowerCase())
      if (new Set(filled).size !== filled.length) {
        issues.push(
          issue('options_duplicate', `Q${n} has two options with the same text.`, {
            question: key,
          }),
        )
      }
    }
    if (question.type === 'money') {
      const low = numberOrNull(question.config?.min)
      const high = numberOrNull(question.config?.max)
      if (low !== null && high !== null && low > high) {
        issues.push(
          issue('money_range', `Q${n} has a minimum larger than its maximum.`, { question: key }),
        )
      }
    }
    const problem = questionConditionProblem(draft, key)
    if (problem) {
      issues.push(
        issue('condition_broken', `Q${n} has a condition that needs attention.`, {
          question: key,
          problem,
        }),
      )
    }
  })

  draft.sections.forEach((section, position) => {
    const problem = sectionConditionProblem(draft, section.key)
    if (problem) {
      issues.push(
        issue('condition_broken', `Section ${position + 1} has a condition that needs attention.`, {
          section: section.key,
          problem,
        }),
      )
    }
  })

  if (draft.questions.length === 0) issues.push(issue('no_questions', 'Add at least one question.'))

  const opens = draft.settings?.opens_at
  const closes = draft.settings?.closes_at
  if (opens && closes && closes <= opens) {
    issues.push(issue('dates_order', 'The closing date must be after the opening date.'))
  }

  return issues
}
