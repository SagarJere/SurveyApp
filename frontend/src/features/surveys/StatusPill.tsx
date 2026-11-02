import { cn } from '@/lib/utils'

import type { SurveyStatus } from './types'

const LABELS: Record<SurveyStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  closed: 'Closed',
}

export function StatusPill({
  status,
  versionNo,
  className,
}: {
  status: SurveyStatus
  versionNo: number | null
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-px text-xs font-semibold',
        status === 'published'
          ? 'border-transparent bg-primary-soft text-primary'
          : 'bg-muted text-foreground',
        className,
      )}
    >
      {LABELS[status]}
      {status !== 'draft' && versionNo ? ` v${versionNo}` : ''}
    </span>
  )
}
