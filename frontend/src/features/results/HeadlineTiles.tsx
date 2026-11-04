import { Skeleton } from '@/components/ui/skeleton'

import type { ResultsSummary } from './api'
import { percent, whole } from './format'

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-heading text-3xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {note ? <dd className="text-sm text-muted-foreground">{note}</dd> : null}
    </div>
  )
}

export function HeadlineTiles({ summary }: { summary: ResultsSummary }) {
  const average = summary.headline?.average
  return (
    <dl className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
      <Tile
        label="Responses"
        value={whole(summary.responses)}
        note={
          summary.invited !== null
            ? `of ${whole(summary.invited)} invited`
            : 'Open to all employees'
        }
      />
      <Tile
        label="Response rate"
        value={summary.response_rate !== null ? percent(summary.response_rate) : '–'}
        note={
          summary.response_rate !== null
            ? `${whole(summary.respondents)} of ${whole(summary.invited ?? 0)} people`
            : summary.invited === 0
              ? 'Nobody in this group was invited'
              : 'No invite list, so no rate'
        }
      />
      {summary.headline && average !== null && average !== undefined ? (
        <Tile
          label="Average score"
          value={`${average.toFixed(1)} / 5`}
          note={summary.headline.text}
        />
      ) : (
        <Tile
          label="Average score"
          value="–"
          note={summary.small_group ? 'Hidden for small groups' : 'No rating answers yet'}
        />
      )}
      {summary.money ? (
        <Tile
          label="Median amount"
          value={summary.money.median_formatted}
          note={summary.money.median_words}
        />
      ) : (
        <Tile
          label="This week"
          value={whole(summary.responses_this_week)}
          note="responses in the last 7 days"
        />
      )}
    </dl>
  )
}

export function HeadlineTilesSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4"
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[118px] rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-3 h-4 w-28" />
        </div>
      ))}
    </div>
  )
}
