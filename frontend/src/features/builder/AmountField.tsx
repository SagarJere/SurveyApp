import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'

import { CURRENCIES, amountInputDisplay, formatAmountInput } from '@/features/survey-logic/money'
import type { Currency } from '@/features/survey-logic/types'
import { cn } from '@/lib/utils'

interface AmountFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type'
> {
  value: number | null
  onValueChange: (value: number | null) => void
  currency: Currency
  allowDecimals: boolean
}

/**
 * Money input that groups digits while typing (₹12,34,567) and keeps the caret in place.
 * Shared by the money settings and condition editors; Phase 3's respondent input builds on it.
 */
export function AmountField({
  value,
  onValueChange,
  currency,
  allowDecimals,
  className,
  onBlur,
  ...props
}: AmountFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  // While typing, show exactly what was typed (e.g. "1,000."); otherwise show the stored value.
  const [typing, setTyping] = useState<string | null>(null)
  const caret = useRef<number | null>(null)
  const symbol = CURRENCIES[currency].symbol

  useLayoutEffect(() => {
    const input = ref.current
    if (caret.current !== null && input && document.activeElement === input) {
      input.setSelectionRange(caret.current, caret.current)
    }
    caret.current = null
  })

  return (
    <span className={cn('relative inline-flex w-full items-center', className)}>
      <span
        className="pointer-events-none absolute left-3 text-sm font-bold text-muted-foreground"
        aria-hidden="true"
      >
        {symbol}
      </span>
      <input
        ref={ref}
        type="text"
        inputMode={allowDecimals ? 'decimal' : 'numeric'}
        autoComplete="off"
        className={cn(
          'h-10 w-full min-w-0 rounded-[10px] border bg-muted pr-3 text-sm tabular-nums outline-none',
          'focus-visible:border-primary focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-primary/20',
          symbol.length > 1 ? 'pl-12' : 'pl-7',
        )}
        value={typing ?? amountInputDisplay(value, currency)}
        onChange={(event) => {
          const result = formatAmountInput(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length,
            currency,
            allowDecimals,
          )
          caret.current = result.caret
          setTyping(result.display)
          onValueChange(result.value)
        }}
        onBlur={(event) => {
          setTyping(null)
          onBlur?.(event)
        }}
        {...props}
      />
    </span>
  )
}
