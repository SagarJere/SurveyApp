import { GitBranchIcon, TriangleAlertIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Small pill above a conditional card: "Shown when Q2 is “Hybrid”" or a warning. */
export function ConditionTag({
  text,
  broken,
  className,
}: {
  text: string
  broken: boolean
  className?: string
}) {
  const Icon = broken ? TriangleAlertIcon : GitBranchIcon
  return (
    <span
      className={cn(
        'flex w-fit max-w-full items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-2 text-xs font-semibold',
        broken ? 'bg-warn-soft text-warn' : 'bg-logic-soft text-logic',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{broken ? 'Condition needs attention' : text}</span>
    </span>
  )
}
