import * as React from 'react'

import { cn } from '@/lib/utils'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    data-slot="textarea"
    className={cn(
      'flex min-h-11 w-full rounded-[10px] border border-transparent bg-muted px-3 py-2.5 text-base transition-[color,background-color,border-color] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
      'focus-visible:border-primary focus-visible:bg-card',
      className,
    )}
    {...props}
  />
))
Textarea.displayName = 'Textarea'
