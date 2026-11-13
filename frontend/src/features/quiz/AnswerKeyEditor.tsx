import { CheckIcon } from 'lucide-react'

import { NumberField } from '@/components/number-field'
import { Switch } from '@/components/ui/switch'
import { useBuilderStore } from '@/features/builder/store'
import { DEFAULT_NUMBER_CONFIG } from '@/features/survey-logic/numbers'
import type { Question, QuizKey } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

import { MARKABLE_TYPES } from './scoring'

const FIELD_LABEL = 'text-xs font-semibold text-muted-foreground'
const MAX_POINTS = 100

/**
 * Trainings: a question's correct answer and points (docs/09-trainings.md). Choice questions
 * tick their correct option(s); Number takes an exact value or an accepted range.
 */
export function AnswerKeyEditor({ question, number }: { question: Question; number: number }) {
  const update = useBuilderStore((s) => s.updateQuestion)
  if (!MARKABLE_TYPES.has(question.type)) return null
  const key = question.quiz ?? null
  const id = (part: string) => `quiz-${part}-${question.key}`
  const set = (quiz: QuizKey | null) => {
    update(question.key, { quiz })
  }

  return (
    <fieldset
      className={cn(
        'mt-3.5 rounded-xl border px-3.5 pt-1.5 pb-3',
        key ? 'border-success/40 bg-success/5' : 'border-dashed',
      )}
    >
      <legend className="sr-only">Correct answer for Q{number}</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Switch
          checked={key !== null}
          label="Marked question"
          onCheckedChange={(on) => {
            set(
              on ? { points: 1, correct_options: [], correct_min: null, correct_max: null } : null,
            )
          }}
        />
        {key ? (
          <span className="inline-flex items-center gap-2 text-sm font-semibold">
            <label htmlFor={id('points')}>Points</label>
            <NumberField
              id={id('points')}
              className="h-9 w-16"
              value={key.points}
              allowDecimals={false}
              allowNegative={false}
              onValueChange={(value) => {
                set({ ...key, points: Math.min(MAX_POINTS, Math.max(1, value ?? 1)) })
              }}
            />
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not scored: collects answers only.</span>
        )}
      </div>
      {key && question.type === 'number' ? (
        <NumberKey question={question} quiz={key} id={id} onChange={set} />
      ) : null}
      {key && question.type !== 'number' ? (
        <ChoiceKey question={question} quiz={key} onChange={set} />
      ) : null}
    </fieldset>
  )
}

function ChoiceKey({
  question,
  quiz,
  onChange,
}: {
  question: Question
  quiz: QuizKey
  onChange: (quiz: QuizKey) => void
}) {
  const one = question.type !== 'multi'
  const correct = new Set(quiz.correct_options ?? [])
  return (
    <div className="mt-1.5">
      <p className={FIELD_LABEL}>
        {one ? 'Tick the correct answer' : 'Tick every correct answer (all are needed to score)'}
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {question.options.map((option, index) => {
          const on = correct.has(option.key)
          const label = option.label.trim() || `Option ${String(index + 1)}`
          return (
            <li key={option.key}>
              <button
                type="button"
                aria-pressed={on}
                className={cn(
                  'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-medium',
                  on
                    ? 'border-success bg-card text-success'
                    : 'text-muted-foreground hover:bg-muted',
                )}
                onClick={() => {
                  const next = one
                    ? on
                      ? []
                      : [option.key]
                    : on
                      ? [...correct].filter((k) => k !== option.key)
                      : question.options
                          .map((o) => o.key)
                          .filter((k) => k === option.key || correct.has(k))
                  onChange({ ...quiz, correct_options: next })
                }}
              >
                <CheckIcon className={cn('size-4', !on && 'opacity-30')} aria-hidden="true" />
                {label}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NumberKey({
  question,
  quiz,
  id,
  onChange,
}: {
  question: Question
  quiz: QuizKey
  id: (part: string) => string
  onChange: (quiz: QuizKey) => void
}) {
  const decimals = question.config.number_decimals ?? DEFAULT_NUMBER_CONFIG.number_decimals
  const low = quiz.correct_min ?? null
  const high = quiz.correct_max ?? null
  return (
    <div className="mt-1.5">
      <div className="grid grid-cols-2 gap-2.5 sm:max-w-sm">
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor={id('min')}>
            Correct from
          </label>
          <NumberField
            id={id('min')}
            value={low}
            allowDecimals={decimals}
            allowNegative
            onValueChange={(value) => {
              // A first value fills both: an exact answer is the common case.
              onChange({ ...quiz, correct_min: value, correct_max: high ?? value })
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor={id('max')}>
            to
          </label>
          <NumberField
            id={id('max')}
            value={high}
            allowDecimals={decimals}
            allowNegative
            onValueChange={(value) => {
              onChange({ ...quiz, correct_max: value })
            }}
          />
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        For one exact answer, use the same number in both boxes.
      </p>
    </div>
  )
}
