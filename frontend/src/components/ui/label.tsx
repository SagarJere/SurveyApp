import * as React from 'react'

import { cn } from '@/lib/utils'

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  // eslint-disable-next-line jsx-a11y/label-has-associated-control -- callers pass htmlFor
  <label
    ref={ref}
    data-slot="label"
    className={cn('text-sm leading-none font-semibold select-none', className)}
    {...props}
  />
))
Label.displayName = 'Label'
