import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

export interface NavigatorItem {
  key: string
  answered: boolean
  /** Starts a new section: a small divider goes before it. */
  newSection: boolean
}

interface NavigatorProps {
  items: NavigatorItem[]
  current: number
  /** Furthest question people may jump to (first unanswered required question or range error). */
  reachable: number
  onGo: (index: number) => void
}

/** Numbered question buttons under the question (docs/06-respondent-experience.md). */
export function Navigator({ items, current, reachable, onGo }: NavigatorProps) {
  const row = useRef<HTMLDivElement>(null)

  // Keep the current number centred on long surveys.
  useEffect(() => {
    const container = row.current
    const button = container?.querySelector<HTMLElement>('[aria-current="step"]')
    if (!container || !button) return
    container.scrollLeft = button.offsetLeft - container.clientWidth / 2 + button.clientWidth / 2
  }, [current])

  return (
    <nav aria-label="Questions">
      <div
        ref={row}
        className="flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-6 pt-1 pb-4 @max-[640px]:px-4.5"
      >
        {items.map((item, index) => {
          const isCurrent = index === current
          const locked = index > reachable
          return (
            <span key={item.key} className="flex shrink-0 items-center gap-1.5">
              {item.newSection && index > 0 ? (
                <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
              ) : null}
              <button
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                aria-label={`Question ${String(index + 1)}${item.answered ? ', answered' : ''}`}
                title={locked ? 'Answer the earlier required questions first' : undefined}
                disabled={locked}
                className={cn(
                  'h-11 min-w-11 rounded-[10px] border bg-card px-2 font-bold text-muted-foreground transition-colors hover:enabled:border-(--survey-accent) disabled:opacity-35',
                  item.answered && 'border-transparent bg-(--survey-accent-soft) text-foreground',
                  isCurrent && 'border-2 border-(--survey-accent) text-foreground',
                )}
                onClick={() => {
                  if (!isCurrent) onGo(index)
                }}
              >
                {index + 1}
              </button>
            </span>
          )
        })}
      </div>
    </nav>
  )
}
