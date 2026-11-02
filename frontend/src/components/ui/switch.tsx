import * as React from 'react'

import { cn } from '@/lib/utils'

export interface SwitchProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: React.ReactNode
}

/** On/off switch built on a native checkbox (role="switch"), as in the UI prototype. */
export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ checked, onCheckedChange, label, className, disabled, ...props }, ref) => (
    <label
      className={cn(
        'relative inline-flex min-h-10 cursor-pointer items-center gap-2.5 text-sm font-semibold select-none',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        role="switch"
        className="peer absolute size-0 opacity-0"
        checked={checked}
        disabled={disabled}
        aria-checked={checked}
        onChange={(event) => {
          onCheckedChange(event.target.checked)
        }}
        {...props}
      />
      <span
        aria-hidden="true"
        className="relative h-[22px] w-9 shrink-0 rounded-full bg-border transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring after:absolute after:top-[3px] after:left-[3px] after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-3.5"
      />
      {label}
    </label>
  ),
)
Switch.displayName = 'Switch'
