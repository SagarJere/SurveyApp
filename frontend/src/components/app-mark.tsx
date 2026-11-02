import { Link } from 'react-router'

import { env } from '@/lib/env'
import { cn } from '@/lib/utils'

export function AppMark({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn('flex min-h-10 items-center gap-2 rounded-md font-semibold', className)}
    >
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="8" className="fill-primary" />
        <path
          d="M9 11h14M9 16h10M9 21h7"
          className="stroke-primary-foreground"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="hidden sm:inline">{env.appName}</span>
      <span className="sr-only sm:hidden">{env.appName} home</span>
    </Link>
  )
}
