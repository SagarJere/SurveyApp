import { forwardRef, useState, type InputHTMLAttributes } from 'react'

import { formatNumber, parseNumberInput } from '@/features/survey-logic/numbers'
import { cn } from '@/lib/utils'

interface NumberFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'type' | 'inputMode'
> {
  value: number | null
  onValueChange: (value: number | null) => void
  allowDecimals: boolean
  allowNegative: boolean
}

/**
 * A number box. Shows "12,34,567" when not being edited and exactly what was typed while
 * editing; ignores keystrokes that can't make a number this field accepts.
 *
 * Phones get the number keypad, except when negatives are allowed: the iPhone keypad has no
 * minus key, so those fields use the full keyboard.
 */
export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  { value, onValueChange, allowDecimals, allowNegative, className, onBlur, ...props },
  ref,
) {
  const [typing, setTyping] = useState<string | null>(null)
  const rules = { decimals: allowDecimals, negative: allowNegative }
  return (
    <input
      ref={ref}
      type="text"
      inputMode={allowNegative ? 'text' : allowDecimals ? 'decimal' : 'numeric'}
      autoComplete="off"
      spellCheck={false}
      className={cn(
        'h-10 w-full min-w-0 rounded-[10px] border bg-muted px-3 text-sm tabular-nums outline-none',
        'focus-visible:border-primary focus-visible:bg-card focus-visible:ring-[3px] focus-visible:ring-primary/20',
        className,
      )}
      {...props}
      value={typing ?? (value === null ? '' : formatNumber(value))}
      onChange={(event) => {
        const parsed = parseNumberInput(event.target.value, rules)
        if (!parsed) return
        setTyping(parsed.text)
        if (parsed.value !== value) onValueChange(parsed.value)
      }}
      onBlur={(event) => {
        setTyping(null)
        onBlur?.(event)
      }}
    />
  )
})
