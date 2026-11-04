import { cn } from '@/lib/utils'

const SIZE = 44
const STROKE = 5
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Response-rate ring: the share of the audience that has responded. */
export function RateRing({
  responded,
  invited,
  rate,
  className,
}: {
  responded: number
  invited: number
  rate: number | null
  className?: string
}) {
  const share = Math.max(0, Math.min(1, rate ?? 0))
  const label =
    rate === null
      ? 'No invite list'
      : `${String(Math.round(share * 100))}% responded, ${String(responded)} of ${String(invited)}`
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
        className="shrink-0 -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={STROKE}
        />
        {share > 0 ? (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--color-chart-1)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${String(share * CIRCUMFERENCE)} ${String(CIRCUMFERENCE)}`}
          />
        ) : null}
      </svg>
      <span className="sr-only">{label}</span>
      <span className="text-sm leading-tight tabular-nums" aria-hidden="true">
        <span className="block font-semibold">
          {rate === null ? '–' : `${String(Math.round(share * 100))}%`}
        </span>
        <span className="block text-xs text-muted-foreground">
          {responded}/{invited}
        </span>
      </span>
    </div>
  )
}
