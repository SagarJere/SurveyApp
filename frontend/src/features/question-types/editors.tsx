import { PlusIcon, XIcon } from 'lucide-react'

import { Switch } from '@/components/ui/switch'
import { NativeSelect } from '@/components/ui/native-select'
import { AmountField } from '@/features/builder/AmountField'
import { useBuilderStore } from '@/features/builder/store'
import { DEFAULT_MONEY_CONFIG } from '@/features/builder/draft-ops'
import {
  amountInWords,
  CURRENCIES,
  CURRENCY_CODES,
  formatAmount,
} from '@/features/survey-logic/money'
import type { MoneyConfig } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

import { RATING_END_LABELS } from './constants'
import type { EditorProps } from './types'

/** Single choice, checkboxes and dropdown: an editable option list. */
export function OptionListEditor({ question }: EditorProps) {
  const updateOption = useBuilderStore((s) => s.updateOption)
  const removeOption = useBuilderStore((s) => s.removeOption)
  const addOption = useBuilderStore((s) => s.addOption)
  const single = question.options.length <= 1

  return (
    <div className="mt-3">
      <ul className="flex flex-col gap-1">
        {question.options.map((option, index) => (
          <li key={option.key} className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                'grid size-[18px] shrink-0 place-items-center border-2 text-[11px] font-bold text-muted-foreground',
                question.type === 'single' && 'rounded-full',
                question.type === 'multi' && 'rounded-[5px]',
                question.type === 'dropdown' && 'border-0',
              )}
            >
              {question.type === 'dropdown' ? index + 1 : null}
            </span>
            <input
              data-option={option.key}
              className="min-h-10 min-w-0 flex-1 border-b border-transparent bg-transparent px-0.5 outline-none hover:border-border focus-visible:border-primary"
              value={option.label}
              placeholder={`Option ${index + 1}`}
              aria-label={`Option ${index + 1}`}
              maxLength={300}
              onChange={(event) => {
                updateOption(question.key, option.key, event.target.value)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  addOption(question.key)
                }
              }}
            />
            <button
              type="button"
              className="grid size-10 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              aria-label={`Remove option ${index + 1}`}
              disabled={single}
              onClick={() => {
                removeOption(question.key, option.key)
              }}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-1.5 px-0.5 text-sm font-semibold text-primary"
        onClick={() => {
          addOption(question.key)
        }}
      >
        <PlusIcon className="size-4" aria-hidden="true" />
        Add option
      </button>
    </div>
  )
}

export function RatingEditor() {
  return (
    <div className="mt-3 max-w-80" aria-hidden="true">
      <div className="grid grid-cols-5 gap-1.5">
        {[1, 2, 3, 4, 5].map((value) => (
          <span
            key={value}
            className="grid h-[38px] place-items-center rounded-[10px] border font-semibold text-muted-foreground"
          >
            {value}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
        <span>{RATING_END_LABELS[0]}</span>
        <span>{RATING_END_LABELS[1]}</span>
      </div>
    </div>
  )
}

export function ShortTextEditor() {
  return (
    <p className="mt-3 max-w-[60%] border-b border-dotted py-2 text-sm text-muted-foreground">
      Short answer text
    </p>
  )
}

export function LongTextEditor() {
  return (
    <p className="mt-3 border-b border-dotted pt-2 pb-7 text-sm text-muted-foreground">
      Long answer text
    </p>
  )
}

const FIELD_LABEL = 'text-muted-foreground text-xs font-semibold'

export function MoneyEditor({ question }: EditorProps) {
  const update = useBuilderStore((s) => s.updateMoneyConfig)
  const config: MoneyConfig = { ...DEFAULT_MONEY_CONFIG, ...question.config }
  const minor = CURRENCIES[config.currency].minor[1]
  const id = (part: string) => `money-${part}-${question.key}`

  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor={id('currency')}>
            Currency
          </label>
          <NativeSelect
            id={id('currency')}
            className="w-full"
            value={config.currency}
            onChange={(event) => {
              update(question.key, { currency: event.target.value as MoneyConfig['currency'] })
            }}
          >
            {CURRENCY_CODES.map((code) => (
              <option key={code} value={code}>
                {code === 'AED' ? 'AED' : `${code} (${CURRENCIES[code].symbol})`}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor={id('min')}>
            Minimum
          </label>
          <AmountField
            id={id('min')}
            value={config.min}
            currency={config.currency}
            allowDecimals={config.decimals}
            placeholder="No minimum"
            onValueChange={(value) => {
              update(question.key, { min: value })
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={FIELD_LABEL} htmlFor={id('max')}>
            Maximum
          </label>
          <AmountField
            id={id('max')}
            value={config.max}
            currency={config.currency}
            allowDecimals={config.decimals}
            placeholder="No maximum"
            onValueChange={(value) => {
              update(question.key, { max: value })
            }}
          />
        </div>
        <Switch
          className="col-span-full"
          checked={config.decimals}
          onCheckedChange={(decimals) => {
            update(question.key, { decimals })
          }}
          label={`Allow ${minor}`}
        />
      </div>
      <div
        className="mt-3 flex max-w-72 items-center gap-2 rounded-[10px] border px-3 py-2 font-semibold text-muted-foreground"
        aria-hidden="true"
      >
        {formatAmount(125000, config.currency)}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground italic">
        Example: {amountInWords(125000, config.currency)}
      </p>
    </div>
  )
}
