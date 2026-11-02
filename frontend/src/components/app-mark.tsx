import { Link } from 'react-router'

import { env } from '@/lib/env'
import { cn } from '@/lib/utils'

/** The Pulse logo: a check mark on an accent tile, as in docs/reference/ui-prototype.html. */
export function AppMark({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'flex min-h-10 items-center gap-2 rounded-md font-heading text-[17px] font-bold',
        className,
      )}
    >
      <span
        className="grid size-[26px] shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-[15px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      </span>
      <span className="hidden sm:inline">{env.appName}</span>
      <span className="sr-only sm:hidden">{env.appName} home</span>
    </Link>
  )
}
