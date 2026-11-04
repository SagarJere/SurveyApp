import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, Loader2Icon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { getResponse, getResponses, resultKeys, type ResponseRow, type ResultFilters } from './api'
import { whole } from './format'

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function when(iso: string): string {
  return dateTime.format(new Date(iso))
}

/** Every response in the current filters, newest first. Only for non-anonymous surveys. */
export function ResponsesTab({ surveyId, filters }: { surveyId: string; filters: ResultFilters }) {
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const currentKey = JSON.stringify(filters)
  const [filterKey, setFilterKey] = useState(currentKey)
  // Back to page 1 whenever the filters change.
  if (filterKey !== currentKey) {
    setFilterKey(currentKey)
    setPage(1)
  }
  const responses = useQuery({
    queryKey: resultKeys.part(surveyId, 'responses', filters, page),
    queryFn: ({ signal }) => getResponses(surveyId, filters, page, signal),
    placeholderData: keepPreviousData,
  })

  if (responses.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-label="Loading responses">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    )
  }
  if (responses.isError) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="text-sm">We couldn&apos;t load the responses.</p>
        <Button
          className="mt-3"
          variant="outline"
          onClick={() => {
            void responses.refetch()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  const { items, total, page_size: size } = responses.data
  const pages = Math.max(1, Math.ceil(total / size))
  const first = total === 0 ? 0 : (page - 1) * size + 1
  const last = Math.min(total, page * size)

  return (
    <section aria-labelledby="responses-title" className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 id="responses-title" className="font-heading text-lg font-semibold">
        Individual responses
      </h2>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0
          ? 'No responses match these filters.'
          : `Showing ${whole(first)}–${whole(last)} of ${whole(total)}.`}
      </p>
      {total > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[320px] text-sm">
            <caption className="sr-only">
              Responses, newest first. Select a name to see the full response.
            </caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th scope="col" className="py-2 pr-2 font-medium">
                  Employee
                </th>
                <th scope="col" className="hidden py-2 pr-2 font-medium sm:table-cell">
                  Department
                </th>
                <th scope="col" className="hidden py-2 pr-2 font-medium md:table-cell">
                  Location
                </th>
                <th scope="col" className="py-2 pr-2 font-medium">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody className={responses.isPlaceholderData ? 'opacity-60' : undefined}>
              {items.map((row) => (
                <ResponseRowView
                  key={row.id}
                  row={row}
                  onOpen={() => {
                    setOpenId(row.id)
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {pages > 1 ? (
        <nav aria-label="Response pages" className="mt-3 flex items-center justify-end gap-2">
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
      <ResponseDialog
        surveyId={surveyId}
        responseId={openId}
        onClose={() => {
          setOpenId(null)
        }}
      />
    </section>
  )
}

function ResponseRowView({ row, onOpen }: { row: ResponseRow; onOpen: () => void }) {
  const name = row.name ?? row.employee_id ?? 'Unknown'
  return (
    <tr className="border-b last:border-0">
      <th scope="row" className="py-1.5 pr-2 text-left font-normal">
        <button
          type="button"
          className="-mx-1.5 rounded-md px-1.5 py-1 text-left font-medium hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onOpen}
        >
          {name}
          {row.name && row.employee_id ? (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {row.employee_id}
            </span>
          ) : null}
        </button>
      </th>
      <td className="hidden py-1.5 pr-2 sm:table-cell">{row.department ?? '–'}</td>
      <td className="hidden py-1.5 pr-2 md:table-cell">{row.location ?? '–'}</td>
      <td className="py-1.5 pr-2 whitespace-nowrap">{when(row.submitted_at)}</td>
    </tr>
  )
}

function ResponseDialog({
  surveyId,
  responseId,
  onClose,
}: {
  surveyId: string
  responseId: string | null
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: [...resultKeys.all(surveyId), 'response', responseId],
    queryFn: () => getResponse(surveyId, responseId ?? ''),
    enabled: responseId !== null,
  })
  const data = detail.data
  return (
    <Dialog
      open={responseId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>
          {data ? (data.name ?? data.employee_id ?? 'Response') : 'Response'}
        </DialogTitle>
        <DialogDescription>
          {data
            ? [
                data.employee_id,
                data.department,
                data.location,
                `Submitted ${when(data.submitted_at)}`,
                `version ${String(data.version_no)}`,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'Loading the full response.'}
        </DialogDescription>
        {detail.isPending ? (
          <div className="flex justify-center py-8">
            <Loader2Icon
              className="size-6 animate-spin text-muted-foreground"
              aria-label="Loading"
            />
          </div>
        ) : detail.isError ? (
          <p className="text-sm text-destructive">We couldn&apos;t load this response.</p>
        ) : (
          <dl className="flex flex-col gap-4">
            {detail.data.answers.map((answer) => (
              <div key={answer.key} className="flex flex-col gap-1">
                <dt className="text-sm font-medium">
                  <span className="text-muted-foreground">Q{answer.number}.</span> {answer.text}
                </dt>
                <dd className="text-sm break-words whitespace-pre-line text-muted-foreground">
                  {answer.answer || 'No answer'}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </DialogContent>
    </Dialog>
  )
}
