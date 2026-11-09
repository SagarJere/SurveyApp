/**
 * Respondent inputs, one per question type (docs/06-respondent-experience.md, Inputs).
 * Selected states use the survey accent; every input is reachable and usable by keyboard.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

import { NumberField } from '@/components/number-field'
import { RATING_END_LABELS } from '@/features/question-types/constants'
import { TEXT_LIMITS } from '@/features/survey-logic/answers'
import {
  amountInputDisplay,
  amountInWords,
  CURRENCIES,
  formatAmountInput,
} from '@/features/survey-logic/money'
import type { Currency, Question } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

export interface InputProps {
  question: Question
  value: unknown
  onChange: (value: unknown) => void
  /** id of the element that labels this input (the question text). */
  labelledBy: string
  /** ids of help/error text that describe this input. */
  describedBy: string | undefined
}

const CARD =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors hover:border-(--survey-accent) has-[:checked]:border-(--survey-accent) has-[:checked]:bg-(--survey-accent-soft) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--survey-accent)'

const FIELD =
  'bg-muted w-full rounded-xl border px-3.5 py-2.5 text-base outline-none focus-visible:border-(--survey-accent) focus-visible:bg-card'

function ChoiceCards({
  question,
  value,
  onChange,
  labelledBy,
  describedBy,
  multiple,
}: InputProps & { multiple: boolean }) {
  const selected = multiple ? (Array.isArray(value) ? (value as string[]) : []) : value
  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-required={!multiple && question.required ? true : undefined}
      className="flex flex-col gap-2"
    >
      {question.options.map((option) => {
        const checked = multiple
          ? (selected as string[]).includes(option.key)
          : selected === option.key
        return (
          <label key={option.key} className={CARD}>
            <input
              type={multiple ? 'checkbox' : 'radio'}
              name={question.key}
              value={option.key}
              checked={checked}
              className="size-[18px] shrink-0 accent-(--survey-accent)"
              onChange={(event) => {
                if (!multiple) {
                  onChange(option.key)
                  return
                }
                const current = selected as string[]
                onChange(
                  event.target.checked
                    ? question.options
                        .map((o) => o.key)
                        .filter((k) => k === option.key || current.includes(k))
                    : current.filter((k) => k !== option.key),
                )
              }}
            />
            <span className="break-words">{option.label}</span>
          </label>
        )
      })}
    </div>
  )
}

function Dropdown({ question, value, onChange, labelledBy, describedBy }: InputProps) {
  return (
    <select
      className={cn(FIELD, 'min-h-11 appearance-auto')}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-required={question.required || undefined}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => {
        onChange(event.target.value || null)
      }}
    >
      <option value="">Choose…</option>
      {question.options.map((option) => (
        <option key={option.key} value={option.key}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

function Rating({ question, value, onChange, labelledBy, describedBy }: InputProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = typeof value === 'number' ? value : null
  // Roving focus: the selected button (or the first) is the single Tab stop.
  const tabStop = current ?? 1

  const move = (event: KeyboardEvent, from: number) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    let next: number | null = null
    if (event.key in keys) next = Math.min(5, Math.max(1, from + (keys[event.key] ?? 0)))
    if (event.key === 'Home') next = 1
    if (event.key === 'End') next = 5
    if (next === null) return
    event.preventDefault()
    onChange(next)
    refs.current[next - 1]?.focus()
  }

  return (
    <div>
      <div
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-required={question.required || undefined}
        className="grid max-w-[340px] grid-cols-5 gap-2"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            ref={(element) => {
              refs.current[n - 1] = element
            }}
            type="button"
            role="radio"
            aria-checked={current === n}
            aria-label={
              n === 1
                ? `1, ${RATING_END_LABELS[0]}`
                : n === 5
                  ? `5, ${RATING_END_LABELS[1]}`
                  : String(n)
            }
            tabIndex={n === tabStop ? 0 : -1}
            className="h-[46px] rounded-xl border bg-card text-base font-bold transition-colors hover:border-(--survey-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--survey-accent) aria-checked:border-(--survey-accent) aria-checked:bg-(--survey-accent) aria-checked:text-(--survey-accent-foreground)"
            onClick={() => {
              onChange(n)
            }}
            onKeyDown={(event) => {
              move(event, n)
            }}
          >
            {n}
          </button>
        ))}
      </div>
      <div
        className="mt-1.5 flex max-w-[340px] justify-between text-xs text-muted-foreground"
        aria-hidden="true"
      >
        <span>{RATING_END_LABELS[0]}</span>
        <span>{RATING_END_LABELS[1]}</span>
      </div>
    </div>
  )
}

function Text({ question, value, onChange, labelledBy, describedBy }: InputProps) {
  const shared = {
    className: FIELD,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    'aria-required': question.required || undefined,
    placeholder: 'Your answer',
    value: typeof value === 'string' ? value : '',
  }
  if (question.type === 'long') {
    return (
      <textarea
        {...shared}
        rows={4}
        maxLength={TEXT_LIMITS.long}
        className={cn(FIELD, 'resize-y')}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    )
  }
  return (
    <input
      {...shared}
      type="text"
      maxLength={TEXT_LIMITS.short}
      onChange={(event) => {
        onChange(event.target.value)
      }}
    />
  )
}

function Money({
  question,
  value,
  onChange,
  labelledBy,
  describedBy,
}: InputProps & { wordsId: string }) {
  const currency: Currency = question.config.currency ?? 'INR'
  const decimals = question.config.decimals === true
  const ref = useRef<HTMLInputElement>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const caret = useRef<number | null>(null)
  const amount = typeof value === 'number' ? value : null
  const symbol = CURRENCIES[currency].symbol

  useLayoutEffect(() => {
    const input = ref.current
    if (caret.current !== null && input && document.activeElement === input) {
      input.setSelectionRange(caret.current, caret.current)
    }
    caret.current = null
  })

  return (
    <div className="relative max-w-[340px]">
      <span
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-bold text-muted-foreground"
        aria-hidden="true"
      >
        {symbol}
      </span>
      <input
        ref={ref}
        type="text"
        inputMode={decimals ? 'decimal' : 'numeric'}
        autoComplete="off"
        placeholder="0"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-required={question.required || undefined}
        className={cn(
          FIELD,
          'text-lg font-semibold tabular-nums',
          symbol.length > 1 ? 'pl-14' : 'pl-9',
        )}
        value={typing ?? amountInputDisplay(amount, currency)}
        onChange={(event) => {
          const result = formatAmountInput(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length,
            currency,
            decimals,
          )
          caret.current = result.caret
          setTyping(result.display)
          onChange(result.value)
        }}
        onBlur={() => {
          setTyping(null)
        }}
      />
    </div>
  )
}

function NumberAnswer({
  question,
  value,
  onChange,
  labelledBy,
  describedBy,
  unitId,
}: InputProps & { unitId: string }) {
  const unit = question.config.number_unit?.trim() ?? ''
  const min = question.config.number_min
  return (
    <div className="flex max-w-[340px] items-center gap-3">
      <NumberField
        value={typeof value === 'number' ? value : null}
        onValueChange={onChange}
        allowDecimals={question.config.number_decimals === true}
        allowNegative={typeof min !== 'number' || min < 0}
        placeholder="0"
        aria-labelledby={labelledBy}
        aria-describedby={
          [unit ? unitId : null, describedBy].filter(Boolean).join(' ') || undefined
        }
        aria-required={question.required || undefined}
        className={cn(FIELD, 'h-auto flex-1 text-lg font-semibold focus-visible:ring-0')}
      />
      {unit ? (
        <span id={unitId} className="shrink-0 font-semibold text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </div>
  )
}

/** Amount in words under a money input, announced politely as it changes. */
export function MoneyWords({
  question,
  value,
  id,
}: {
  question: Question
  value: unknown
  id: string
}) {
  const currency: Currency = question.config.currency ?? 'INR'
  return (
    <p
      id={id}
      aria-live="polite"
      className="mt-2 min-h-[1.4em] text-sm font-semibold text-(--survey-accent) dark:brightness-150"
    >
      {typeof value === 'number' ? amountInWords(value, currency) : ''}
    </p>
  )
}

export function QuestionInput(props: InputProps & { wordsId: string; unitId: string }) {
  switch (props.question.type) {
    case 'single':
      return <ChoiceCards {...props} multiple={false} />
    case 'multi':
      return <ChoiceCards {...props} multiple />
    case 'dropdown':
      return <Dropdown {...props} />
    case 'rating':
      return <Rating {...props} />
    case 'short':
    case 'long':
      return <Text {...props} />
    case 'money':
      return <Money {...props} />
    case 'number':
      return <NumberAnswer {...props} />
  }
}
