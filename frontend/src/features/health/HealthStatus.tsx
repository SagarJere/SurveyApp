import { cn } from '@/lib/utils'
import { ApiError } from '@/lib/api'

import { useHealth } from './use-health'

type State = 'checking' | 'ok' | 'down'

const LABELS: Record<State, string> = {
  checking: 'Checking connection…',
  ok: 'Connected',
  down: 'Server unreachable',
}

const DOT_CLASSES: Record<State, string> = {
  checking: 'bg-muted-foreground animate-pulse',
  ok: 'bg-success',
  down: 'bg-destructive',
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'The server did not respond.'
}

/**
 * Small status pill for the app header. Clicking it re-checks immediately.
 * Text is hidden on narrow screens but stays available to screen readers.
 */
export function HealthStatus({ className }: { className?: string }) {
  const { isPending, isError, isFetching, error, refetch } = useHealth()
  const state: State = isPending ? 'checking' : isError ? 'down' : 'ok'
  const detail = state === 'down' ? describeError(error) : LABELS[state]

  return (
    <button
      type="button"
      onClick={() => void refetch()}
      disabled={isFetching}
      title={`${detail} Click to check again.`}
      className={cn(
        'inline-flex min-h-10 items-center gap-2 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-progress',
        className,
      )}
    >
      <span className={cn('size-2.5 rounded-full', DOT_CLASSES[state])} aria-hidden="true" />
      <span role="status" aria-live="polite" className="sr-only sm:not-sr-only">
        {LABELS[state]}
      </span>
    </button>
  )
}
