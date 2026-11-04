import { ChartColumnIcon, TableIcon } from 'lucide-react'
import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'

import { Button } from '@/components/ui/button'

import type { Timeline } from './api'
import { dayMonth, whole } from './format'

function ChartTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  const point = payload?.[0]?.payload as { day: string; n: number } | undefined
  if (!active || !point) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
      <p className="font-medium">{dayMonth(point.day)}</p>
      <p className="text-muted-foreground">
        {whole(point.n)} {point.n === 1 ? 'response' : 'responses'}
      </p>
    </div>
  )
}

export function DailyChart({ timeline }: { timeline: Timeline }) {
  const [asTable, setAsTable] = useState(false)
  const total = timeline.days.reduce((sum, d) => sum + d.n, 0)
  const busiest = timeline.days.reduce<{ day: string; n: number } | null>(
    (best, d) => (best === null || d.n > best.n ? d : best),
    null,
  )

  return (
    <section aria-labelledby="daily-title" className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="daily-title" className="font-heading text-lg font-semibold">
            Responses per day
          </h2>
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? 'No responses in this period.'
              : busiest
                ? `Busiest day: ${dayMonth(busiest.day)}, with ${whole(busiest.n)}.`
                : null}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={asTable}
          onClick={() => {
            setAsTable((v) => !v)
          }}
        >
          {asTable ? <ChartColumnIcon aria-hidden="true" /> : <TableIcon aria-hidden="true" />}
          {asTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>

      {asTable ? (
        <div className="mt-3 max-h-72 overflow-y-auto">
          <DaysTable timeline={timeline} />
        </div>
      ) : (
        <>
          <div className="mt-3 h-56" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              {/* Keyboard and screen-reader users get the table, so the chart takes no focus. */}
              <BarChart
                accessibilityLayer={false}
                data={timeline.days}
                margin={{ top: 8, right: 4, bottom: 0, left: -12 }}
              >
                <CartesianGrid vertical={false} stroke="var(--color-border)" strokeWidth={1} />
                <XAxis
                  dataKey="day"
                  tickFormatter={dayMonth}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                  tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={{ fill: 'var(--color-muted-foreground)', fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-muted)' }}
                  content={<ChartTooltip />}
                  isAnimationActive={false}
                />
                {timeline.reminders.map((day) => (
                  <ReferenceLine
                    key={day}
                    x={day}
                    stroke="var(--color-muted-foreground)"
                    strokeDasharray="4 4"
                    label={{
                      value: 'Reminder',
                      position: 'top',
                      fontSize: 11,
                      fill: 'var(--color-muted-foreground)',
                    }}
                  />
                ))}
                <Bar
                  dataKey="n"
                  name="Responses"
                  fill="var(--color-chart-1)"
                  maxBarSize={24}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {/* The chart is hidden from screen readers; they get the same numbers as a table. */}
          <div className="sr-only">
            <DaysTable timeline={timeline} />
          </div>
        </>
      )}
    </section>
  )
}

function DaysTable({ timeline }: { timeline: Timeline }) {
  const reminders = new Set(timeline.reminders)
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Responses per day</caption>
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th scope="col" className="py-2 font-medium">
            Day
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Responses
          </th>
        </tr>
      </thead>
      <tbody>
        {timeline.days.map((d) => (
          <tr key={d.day} className="border-b last:border-0">
            <td className="py-1.5">
              {dayMonth(d.day)}
              {reminders.has(d.day) ? ' (reminder sent)' : ''}
            </td>
            <td className="py-1.5 text-right tabular-nums">{whole(d.n)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
