import { formatAmount } from '@/features/survey-logic/money'
import type { Currency } from '@/features/survey-logic/types'

import type { QuestionResult } from './api'
import { percent, whole } from './format'

/** A labelled list of horizontal bars: "Hybrid ▇▇▇▇ 42% · 60". */
export function ShareBars({
  items,
  label,
}: {
  items: { key: string; label: string; n: number; share: number }[]
  label: string
}) {
  return (
    <ul className="flex flex-col gap-3" aria-label={label}>
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{item.label}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {percent(item.share)} · {whole(item.n)}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-chart-1"
              style={{ width: `${String(Math.min(100, item.share * 100))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ChoiceWidget({ question }: { question: QuestionResult }) {
  return (
    <div className="flex flex-col gap-3">
      <ShareBars
        items={question.options ?? []}
        label={`Answers to question ${String(question.number)}`}
      />
      {question.type === 'multi' ? (
        <p className="text-sm text-muted-foreground">
          They could pick more than one, so shares add up to more than 100%.
        </p>
      ) : null}
    </div>
  )
}

const RATING_LABELS: Record<number, string> = { 1: '1 (lowest)', 5: '5 (highest)' }

export function RatingWidget({ question }: { question: QuestionResult }) {
  const distribution = question.distribution ?? []
  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-6">
      <div>
        <p className="font-heading text-4xl font-semibold tabular-nums">
          {question.average !== null && question.average !== undefined
            ? question.average.toFixed(1)
            : '–'}
          <span className="ml-1 text-base font-normal text-muted-foreground">/ 5</span>
        </p>
        <p className="text-sm text-muted-foreground">Average</p>
      </div>
      <ShareBars
        label={`Ratings for question ${String(question.number)}`}
        items={[...distribution].reverse().map((d) => ({
          key: String(d.value),
          label: RATING_LABELS[d.value] ?? String(d.value),
          n: d.n,
          share: d.share,
        }))}
      />
    </div>
  )
}

function Stat({ label, value, words }: { label: string; value: string; words?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-background p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold break-words tabular-nums">{value}</dd>
      {words ? <dd className="text-xs text-muted-foreground">{words}</dd> : null}
    </div>
  )
}

export function MoneyWidget({ question }: { question: QuestionResult }) {
  const currency = (question.currency ?? 'INR') as Currency
  const stats = question.stats
  const money = (value: number | null | undefined) =>
    value === null || value === undefined ? '–' : formatAmount(value, currency)
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label="Total" value={money(stats?.total)} />
        <Stat label="Average" value={money(stats?.average)} words={stats?.average_words} />
        <Stat label="Median" value={money(stats?.median)} words={stats?.median_words} />
        <Stat label="Lowest" value={money(stats?.min)} />
        <Stat label="Highest" value={money(stats?.max)} />
      </dl>
      <ShareBars
        label={`Amount ranges for question ${String(question.number)}`}
        items={(question.ranges ?? []).map((r) => ({ key: r.label, ...r }))}
      />
    </div>
  )
}
