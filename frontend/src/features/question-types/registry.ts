import {
  AlignLeftIcon,
  BanknoteIcon,
  CircleDotIcon,
  ListIcon,
  SquareCheckIcon,
  StarIcon,
  TextIcon,
} from 'lucide-react'

import { TYPE_RULES } from '@/features/survey-logic/conditions'
import type { QuestionType } from '@/features/survey-logic/types'

import {
  LongTextEditor,
  MoneyEditor,
  OptionListEditor,
  RatingEditor,
  ShortTextEditor,
} from './editors'
import type { QuestionTypeDef } from './types'

function define(def: Omit<QuestionTypeDef, 'hasOptions' | 'conditionOps'>): QuestionTypeDef {
  return { ...def, ...TYPE_RULES[def.type] }
}

/** Every question type, in the order the type picker shows them. */
export const QUESTION_TYPES: Record<QuestionType, QuestionTypeDef> = {
  single: define({
    type: 'single',
    label: 'Single choice',
    icon: CircleDotIcon,
    Editor: OptionListEditor,
  }),
  multi: define({
    type: 'multi',
    label: 'Checkboxes',
    icon: SquareCheckIcon,
    Editor: OptionListEditor,
  }),
  dropdown: define({
    type: 'dropdown',
    label: 'Dropdown',
    icon: ListIcon,
    Editor: OptionListEditor,
  }),
  rating: define({ type: 'rating', label: 'Rating 1–5', icon: StarIcon, Editor: RatingEditor }),
  short: define({ type: 'short', label: 'Short answer', icon: TextIcon, Editor: ShortTextEditor }),
  long: define({ type: 'long', label: 'Paragraph', icon: AlignLeftIcon, Editor: LongTextEditor }),
  money: define({ type: 'money', label: 'Money', icon: BanknoteIcon, Editor: MoneyEditor }),
}

export const QUESTION_TYPE_LIST = Object.values(QUESTION_TYPES)
