import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, Loader2Icon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  downloadCompletion,
  getCompletion,
  resultKeys,
  type CompletionPerson,
  type CompletionStatus,
  type ResultFilters,
} from './api'
import { whole } from './format'

const STATUS: Record<CompletionStatus, { label: string; tone: string }> = {
  passed: { label: 'Passed', tone: 'bg-success/6 text-success' },
  not_passed: { label: 'Not passed', tone: 'bg-warn-soft text-warn' },
  completed: { label: 'Completed', tone: 'bg-success/6 text-success' },
  in_progress: { label: 'In progress', tone: 'bg-primary-soft text-primary-soft-foreground' },
  not_started: { label: 'Not started', tone: 'bg-muted text-muted-foreground' },
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function StatusBadge({ status }: { status: CompletionStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        STATUS[status].tone,
      )}
    >
      {STATUS[status].label}
    </span>
  )
}

function lateText(row: CompletionPerson): string | null {
  if (!row.late) return null
  return row.completed_at ? 'Late' : 'Overdue'
}

/**
 * Trainings: everyone in the audience (including people who haven't started) with their
 * status, best score, attempts and completed date. Department and location filters apply.
 */
export function CompletionTab({
  surveyId,
  filters,
  title,
}: {
  surveyId: string
  filters: ResultFilters
  title: string
}) {
  const [status, setStatus] = useState<CompletionStatus | null>(null)
  const [page, setPage] = useState(1)
  const [downloading, setDownloading] = useState(false)
  const currentKey = JSON.stringify(filters)
  const [filterKey, setFilterKey] = useState(currentKey)
  if (filterKey !== currentKey) {
    setFilterKey(currentKey)
    setPage(1)
  }
  const report = useQuery({
    queryKey: resultKeys.part(surveyId, 'completion', filters, { status, page }),
    queryFn: ({ signal }) => getCompletion(surveyId, filters, { status, page }, signal),
    placeholderData: keepPreviousData,
  })

  if (report.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading the completion report">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    )
  }
  if (report.isError) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="text-sm">We couldn&apos;t load the completion report.</p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => {
            void report.refetch()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  const data = report.data
  const statuses = (Object.keys(STATUS) as CompletionStatus[]).filter((s) =>
    data.has_pass_mark ? s !== 'completed' : s !== 'passed' && s !== 'not_passed',
  )
  const pages = Math.max(1, Math.ceil(data.matching / data.page_size))
  const first = data.matching === 0 ? 0 : (page - 1) * data.page_size + 1
  const last = Math.min(data.matching, page * data.page_size)
  const choose = (next: CompletionStatus | null) => {
    setStatus(next)
    setPage(1)
  }

  return (
    <section aria-labelledby="completion-title" className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="completion-title" className="font-heading text-lg font-semibold">
            Completion report
          </h2>
          <p className="text-sm text-muted-foreground">
            Everyone in the audience, with their best attempt.
            {data.due_date
              ? ` Due ${shortDate(data.due_date)}: ${whole(data.late)} late or overdue.`
              : ''}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={downloading}
          onClick={() => {
            setDownloading(true)
            downloadCompletion(surveyId, filters, title, status)
              .catch(() => {
                // The API client already showed what went wrong.
              })
              .finally(() => {
                setDownloading(false)
              })
          }}
        >
          {downloading ? (
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
          Download (Excel)
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Status">
        {[null, ...statuses].map((value) => (
          <button
            key={value ?? 'all'}
            type="button"
            aria-pressed={status === value}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold text-muted-foreground aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-foreground"
            onClick={() => {
              choose(value)
            }}
          >
            {value ? STATUS[value].label : 'Everyone'}
            <span className="tabular-nums">{whole(value ? data.counts[value] : data.total)}</span>
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {data.matching === 0
          ? 'Nobody matches.'
          : `Showing ${whole(first)}–${whole(last)} of ${whole(data.matching)}.`}
      </p>

      {data.matching > 0 ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[320px] text-sm">
            <caption className="sr-only">
              Completion report: status, best score, attempts and completed date per person.
            </caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-2 font-medium">
                  Employee
                </th>
                <th scope="col" className="hidden py-2 pr-2 font-medium md:table-cell">
                  Department
                </th>
                <th scope="col" className="py-2 pr-2 font-medium">
                  Status
                </th>
                <th scope="col" className="hidden py-2 pr-2 text-right font-medium sm:table-cell">
                  Best
                </th>
                <th scope="col" className="hidden py-2 pr-2 text-right font-medium sm:table-cell">
                  Attempts
                </th>
                <th scope="col" className="hidden py-2 pr-2 font-medium sm:table-cell">
                  Completed
                </th>
              </tr>
            </thead>
            <tbody className={report.isPlaceholderData ? 'opacity-60' : undefined}>
              {data.rows.map((row) => {
                const late = lateText(row)
                return (
                  <tr key={row.employee_id} className="border-b last:border-b-0">
                    <td className="py-2 pr-2">
                      <span className="block font-medium break-words">
                        {row.name ?? row.employee_id}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {row.employee_id}
                        <span className="md:hidden">
                          {row.department ? ` · ${row.department}` : ''}
                        </span>
                      </span>
                    </td>
                    <td className="hidden py-2 pr-2 md:table-cell">
                      {row.department ?? '–'}
                      {row.location ? (
                        <span className="block text-xs text-muted-foreground">{row.location}</span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      <StatusBadge status={row.status} />
                      {row.best_score !== null ? (
                        <span className="ml-1.5 text-xs tabular-nums sm:hidden">
                          {row.best_score}%
                        </span>
                      ) : null}
                      {late ? (
                        <span className="mt-0.5 block text-xs font-semibold text-warn">{late}</span>
                      ) : null}
                    </td>
                    <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">
                      {row.best_score !== null ? `${String(row.best_score)}%` : '–'}
                    </td>
                    <td className="hidden py-2 pr-2 text-right tabular-nums sm:table-cell">
                      {row.attempts || '–'}
                    </td>
                    <td className="hidden py-2 pr-2 whitespace-nowrap sm:table-cell">
                      {row.completed_at ? dateTime.format(new Date(row.completed_at)) : '–'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {pages > 1 ? (
        <nav aria-label="Completion pages" className="mt-3 flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => {
              setPage((p) => p - 1)
            }}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => {
              setPage((p) => p + 1)
            }}
          >
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </nav>
      ) : null}
    </section>
  )
}
