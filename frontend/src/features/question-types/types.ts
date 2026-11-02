import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

import type { ConditionOp, Question, QuestionType } from '@/features/survey-logic/types'

export interface EditorProps {
  question: Question
}

/**
 * One question type (docs/02-architecture.md, "Question type registry"). Later phases add the
 * respondent Renderer, answer validation and the results ReportWidget to this interface.
 */
export interface QuestionTypeDef {
  type: QuestionType
  label: string
  icon: LucideIcon
  hasOptions: boolean
  /** Empty when this type can't be a condition source. */
  conditionOps: readonly ConditionOp[]
  /** The type-specific part of the builder card. */
  Editor: ComponentType<EditorProps>
}
