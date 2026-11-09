import type { ComponentType } from 'react'

import type { QuestionType } from '@/features/survey-logic/types'

import type { QuestionResult } from './api'
import { ChoiceWidget, MoneyWidget, NumberWidget, RatingWidget } from './widgets'

/** Same names as the builder's type picker (kept here so results don't load the builder). */
export const TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Single choice',
  multi: 'Checkboxes',
  dropdown: 'Dropdown',
  rating: 'Rating 1–5',
  short: 'Short answer',
  long: 'Paragraph',
  money: 'Money',
  number: 'Number',
}

export type TextType = 'short' | 'long'

export function isTextType(type: QuestionType): type is TextType {
  return type === 'short' || type === 'long'
}

/** The results widget for each question type. Text questions show the comments list instead. */
export const REPORT_WIDGETS: Record<
  Exclude<QuestionType, TextType>,
  ComponentType<{ question: QuestionResult }>
> = {
  single: ChoiceWidget,
  dropdown: ChoiceWidget,
  multi: ChoiceWidget,
  rating: RatingWidget,
  money: MoneyWidget,
  number: NumberWidget,
}
