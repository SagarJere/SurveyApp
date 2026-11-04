import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  /** 1 when the empty state is the whole page, so the page still has a main heading. */
  level?: 1 | 2
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  level = 2,
}: EmptyStateProps) {
  const Heading = level === 1 ? 'h1' : 'h2'
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center',
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <Heading className="text-lg font-semibold">{title}</Heading>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  )
}
