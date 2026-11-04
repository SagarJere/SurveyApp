import { TriangleAlertIcon } from 'lucide-react'

import { NativeSelect } from '@/components/ui/native-select'
import {
  conditionOpsFor,
  eligibleSourcesForQuestion,
  eligibleSourcesForSection,
  RATING_VALUES,
  type ConditionProblem,
} from '@/features/survey-logic/conditions'
import type { Condition, ConditionOp, Currency, Draft } from '@/features/survey-logic/types'

import { AmountField } from '@/components/amount-field'
import { OP_LABELS, problemMessage } from './condition-text'
import { conditionFor, type ConditionTarget } from './draft-ops'
import { useBuilderStore } from './store'

function truncate(text: string, length: number): string {
  const value = text.trim() || 'Untitled question'
  return value.length > length ? `${value.slice(0, length - 1)}…` : value
}

interface ConditionPanelProps {
  target: ConditionTarget
  condition: Condition | null
  problem: ConditionProblem | null
}

/** "Show this question only when [Q2 ▾] [is ▾] [Hybrid ▾]", with broken-condition help. */
export function ConditionPanel({ target, condition, problem }: ConditionPanelProps) {
  const draft = useBuilderStore((s) => s.draft)
  const setCondition = useBuilderStore((s) => s.setCondition)
  const closePrompt = useBuilderStore((s) => s.closeConditionPrompt)
  const noun = target.kind === 'question' ? 'question' : 'section'

  if (!condition) {
    return (
      <div className="mt-3 rounded-xl border border-logic/25 bg-logic-soft px-3.5 py-3 text-sm">
        <p>
          {target.kind === 'question'
            ? 'Add a choice or rating question above this one. Then you can show this question based on its answer.'
            : 'Add a choice or rating question in an earlier section. Then you can show this section based on its answer.'}
        </p>
        <button type="button" className="min-h-10 font-semibold text-logic" onClick={closePrompt}>
          Close
        </button>
      </div>
    )
  }

  const sources =
    target.kind === 'question'
      ? eligibleSourcesForQuestion(draft, target.key)
      : eligibleSourcesForSection(draft, target.key)
  const source = sources.find((q) => q.key === condition.src)
  const update = (next: Condition | null) => {
    setCondition(target, next)
  }
  const id = (part: string) => `cond-${part}-${target.key}`

  return (
    <div
      className="mt-3 rounded-xl border border-logic/25 bg-logic-soft px-3.5 pt-3 pb-1.5"
      role="group"
      aria-label={`Condition for this ${noun}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-logic">
        <span>Show this {noun} only when</span>
        <NativeSelect
          id={id('src')}
          aria-label="Depends on question"
          className="bg-card font-normal text-foreground"
          value={source ? source.key : ''}
          onChange={(event) => {
            const next = sources.find((q) => q.key === event.target.value)
            if (next) update(conditionFor(next))
          }}
        >
          {source ? null : (
            <option value="" disabled>
              Choose a question
            </option>
          )}
          {sources.map((q) => (
            <option key={q.key} value={q.key}>
              Q{draft.questions.indexOf(q) + 1}: {truncate(q.text, 34)}
            </option>
          ))}
        </NativeSelect>
        {source ? (
          <>
            <NativeSelect
              id={id('op')}
              aria-label="Comparison"
              className="bg-card font-normal text-foreground"
              value={condition.op}
              onChange={(event) => {
                update({ ...condition, op: event.target.value as ConditionOp })
              }}
            >
              {conditionOpsFor(source.type).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </NativeSelect>
            <ValueInput
              draft={draft}
              condition={condition}
              sourceKey={source.key}
              inputId={id('val')}
              onChange={(val) => {
                update({ ...condition, val })
              }}
            />
          </>
        ) : null}
      </div>
      {problem ? (
        <p className="mt-2.5 flex items-start gap-2 text-sm font-semibold text-warn" role="note">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{problemMessage(draft, condition, problem)}</span>
        </p>
      ) : null}
      <button
        type="button"
        className="min-h-10 text-sm font-semibold text-logic"
        onClick={() => {
          update(null)
        }}
      >
        Remove condition
      </button>
    </div>
  )
}

function ValueInput({
  draft,
  condition,
  sourceKey,
  inputId,
  onChange,
}: {
  draft: Draft
  condition: Condition
  sourceKey: string
  inputId: string
  onChange: (val: Condition['val']) => void
}) {
  const source = draft.questions.find((q) => q.key === sourceKey)
  if (!source) return null

  if (source.type === 'money') {
    const currency: Currency = source.config.currency ?? 'INR'
    return (
      <AmountField
        id={inputId}
        aria-label="Amount"
        className="w-36 font-normal text-foreground"
        value={typeof condition.val === 'number' ? condition.val : null}
        currency={currency}
        allowDecimals={source.config.decimals === true}
        onValueChange={onChange}
      />
    )
  }

  const values =
    source.type === 'rating'
      ? RATING_VALUES.map((v) => ({ value: String(v), label: String(v) }))
      : source.options.map((o) => ({ value: o.key, label: o.label.trim() || 'Untitled option' }))
  const current = condition.val === null ? '' : String(condition.val)
  const known = values.some((v) => v.value === current)

  return (
    <NativeSelect
      id={inputId}
      aria-label="Answer"
      className="bg-card font-normal text-foreground"
      value={known ? current : ''}
      onChange={(event) => {
        onChange(source.type === 'rating' ? Number(event.target.value) : event.target.value)
      }}
    >
      {known ? null : (
        <option value="" disabled>
          Choose an answer
        </option>
      )}
      {values.map((v) => (
        <option key={v.value} value={v.value}>
          {v.label}
        </option>
      ))}
    </NativeSelect>
  )
}
