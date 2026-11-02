import * as React from 'react'

import { cn } from '@/lib/utils'

/** A styled native <select>: best keyboard, screen reader and phone support. */
export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    data-slot="native-select"
    className={cn(
      'min-h-10 max-w-full min-w-0 appearance-none rounded-[10px] border bg-muted bg-[length:12px] bg-[right_11px_center] bg-no-repeat py-2 pr-8 pl-3 text-sm outline-none',
      'focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20',
      "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237A8B87' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")]",
      className,
    )}
    {...props}
  />
))
NativeSelect.displayName = 'NativeSelect'
