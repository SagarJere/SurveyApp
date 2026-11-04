import { DownloadIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { DepartmentRow, ParticipationResult } from './api'
import { LOW_RATE, percent, whole } from './format'

interface ParticipationTableProps {
  participation: ParticipationResult
  selected: string | null
  onSelect: (department: string | null) => void
  canDownload: boolean
  downloading: boolean
  onDownload: () => void
}

export function ParticipationTable({
  participation,
  selected,
  onSelect,
  canDownload,
  downloading,
  onDownload,
}: ParticipationTableProps) {
  const rows = participation.departments
  return (
    <section aria-labelledby="participation-title" className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="participation-title" className="font-heading text-lg font-semibold">
            Participation by department
          </h2>
          <p className="text-sm text-muted-foreground">
            {participation.open_to_all
              ? 'Open to all employees, so only responses are counted.'
              : 'Select a department to filter the whole page.'}
          </p>
        </div>
        {canDownload && !participation.open_to_all ? (
          <Button variant="outline" size="sm" disabled={downloading} onClick={onDownload}>
            {downloading ? (
              <Loader2Icon className="animate-spin" aria-hidden="true" />
            ) : (
              <DownloadIcon aria-hidden="true" />
            )}
            Download non-responders
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nobody to show yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[320px] text-sm">
            <caption className="sr-only">
              Invited, responded and response rate by department
            </caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-2 font-medium">
                  Department
                </th>
                {participation.open_to_all ? null : (
                  <th scope="col" className="hidden py-2 pr-2 text-right font-medium sm:table-cell">
                    Invited
                  </th>
                )}
                <th scope="col" className="py-2 pr-2 text-right font-medium">
                  Responded
                </th>
                {participation.open_to_all ? null : (
                  <th scope="col" className="w-[40%] py-2 font-medium">
                    Rate
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Row
                  key={row.department ?? ''}
                  row={row}
                  openToAll={participation.open_to_all}
                  selected={selected !== null && selected === (row.department ?? '')}
                  onSelect={onSelect}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Row({
  row,
  openToAll,
  selected,
  onSelect,
}: {
  row: DepartmentRow
  openToAll: boolean
  selected: boolean
  onSelect: (department: string | null) => void
}) {
  const name = row.department ?? 'Not recorded'
  const low = row.rate !== null && row.rate < LOW_RATE
  return (
    <tr className={cn('border-b last:border-0', selected && 'bg-primary-soft/60')}>
      <th scope="row" className="py-1.5 pr-2 text-left font-normal">
        <button
          type="button"
          aria-pressed={selected}
          className="-mx-1.5 rounded-md px-1.5 py-1 text-left font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => {
            onSelect(selected ? null : (row.department ?? ''))
          }}
        >
          {name}
          <span className="sr-only">
            {selected ? ' (filtering, select to clear)' : ', filter by this department'}
          </span>
        </button>
      </th>
      {openToAll ? null : (
        <td className="hidden py-1.5 pr-2 text-right tabular-nums sm:table-cell">
          {row.invited !== null ? whole(row.invited) : '–'}
        </td>
      )}
      <td className="py-1.5 pr-2 text-right tabular-nums">{whole(row.responded)}</td>
      {openToAll ? null : (
        <td className="py-1.5">
          <div className="flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className={cn('h-full rounded-full', low ? 'bg-chart-low' : 'bg-chart-1')}
                style={{ width: `${String(Math.min(100, Math.round((row.rate ?? 0) * 100)))}%` }}
              />
            </div>
            <span className="flex w-20 shrink-0 items-center justify-end gap-1 tabular-nums">
              {low ? (
                <>
                  <TriangleAlertIcon className="size-3.5 text-chart-low" aria-hidden="true" />
                  <span className="text-xs font-semibold">Low</span>
                </>
              ) : null}
              {percent(row.rate)}
            </span>
          </div>
        </td>
      )}
    </tr>
  )
}
