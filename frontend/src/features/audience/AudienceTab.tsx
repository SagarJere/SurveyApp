import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  SearchIcon,
  TriangleAlertIcon,
  UploadIcon,
  UserMinusIcon,
} from 'lucide-react'
import { useEffect, useId, useState, type DragEvent, type ReactNode } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useBuilderStore } from '@/features/builder/store'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  applyUpload,
  audienceKeys,
  discardUpload,
  downloadRowsToFix,
  downloadTemplate,
  listAudience,
  removeMember,
  setOpenToAll,
  uploadAudience,
  type AudienceQuery,
  type UploadMode,
  type UploadPreview,
} from './api'

const ACCEPT = '.xlsx,.csv'
const SMALL_ANONYMOUS = 10

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className="mb-3.5 rounded-2xl border bg-card px-5 py-4.5" aria-labelledby={id}>
      <h2 id={id} className="mb-1.5 text-[19px] font-semibold">
        {title}
      </h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  )
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delay])
  return debounced
}

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'

/** Audience tab (docs/05-survey-builder.md, Audience tab). */
export function AudienceTab() {
  const surveyId = useBuilderStore((s) => s.surveyId) ?? ''
  const anonymous = useBuilderStore((s) => s.draft.settings.anonymous)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<UploadMode>('append')
  const [preview, setPreview] = useState<UploadPreview | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const debouncedSearch = useDebounced(search, 300)
  const query: AudienceQuery = { search: debouncedSearch, department, page }

  const list = useQuery({
    queryKey: audienceKeys.list(surveyId, query),
    queryFn: ({ signal }) => listAudience(surveyId, query, signal),
    placeholderData: keepPreviousData,
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: audienceKeys.all(surveyId) })

  const openToAll = useMutation({
    mutationFn: (value: boolean) => setOpenToAll(surveyId, value),
    onSuccess: () => void refresh(),
  })
  const upload = useMutation({
    mutationFn: (file: File) => uploadAudience(surveyId, file, mode),
    onMutate: () => {
      setUploadError(null)
      setPreview(null)
    },
    onSuccess: setPreview,
    onError: (error) => {
      setUploadError(errorMessage(error))
    },
  })
  const apply = useMutation({
    mutationFn: (uploadId: string) => applyUpload(surveyId, uploadId),
    onSuccess: ({ audience_count }) => {
      setPreview(null)
      setPage(1)
      void refresh()
      toast.success(
        `Audience updated. ${String(audience_count)} ${audience_count === 1 ? 'person' : 'people'} can respond.`,
      )
    },
  })
  const discard = useMutation({
    mutationFn: (uploadId: string) => discardUpload(surveyId, uploadId),
    onSuccess: () => {
      setPreview(null)
    },
  })
  const remove = useMutation({
    mutationFn: (employeeId: string) => removeMember(surveyId, employeeId),
    onSuccess: (_, employeeId) => {
      void refresh()
      toast.success(`Removed ${employeeId} from the audience.`)
    },
  })

  const pickFile = (file: File | undefined) => {
    if (!file) return
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      setUploadError('Upload an Excel (.xlsx) or CSV (.csv) file.')
      return
    }
    upload.mutate(file)
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    pickFile(event.dataTransfer.files[0])
  }

  const data = list.data
  const isOpen = data?.open_to_all ?? false
  const pages = data ? Math.max(1, Math.ceil(data.matching / data.page_size)) : 1

  return (
    <>
      <Panel title="Who can respond">
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">Open to all employees</span>
            <span id="open-to-all-description" className="text-sm text-muted-foreground">
              Skip the list and let anyone who signs in respond.
            </span>
          </div>
          <Switch
            checked={isOpen}
            disabled={!data || openToAll.isPending}
            onCheckedChange={(value) => {
              openToAll.mutate(value)
            }}
            label={<span className="sr-only">Open to all employees</span>}
            aria-describedby="open-to-all-description"
          />
        </div>
      </Panel>

      {anonymous && data && !isOpen && data.total > 0 && data.total < SMALL_ANONYMOUS ? (
        <p
          className="mb-3.5 flex gap-2 rounded-xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn"
          role="note"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Only {data.total} {data.total === 1 ? 'person is' : 'people are'} in the audience. With
          anonymous responses, answers from a group this small may be easy to identify.
        </p>
      ) : null}

      {isOpen ? null : (
        <>
          <Panel
            title="Employee list"
            description="Upload an Excel or CSV file with an EmployeeId column. Name, Email, Department and Location are optional."
          >
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div
                className="inline-flex rounded-full border bg-muted p-[3px]"
                role="group"
                aria-label="How to use the file"
              >
                {(['append', 'replace'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    disabled={value === 'replace' && data?.can_replace === false}
                    title={
                      value === 'replace' && data?.can_replace === false
                        ? 'Not possible after publishing'
                        : undefined
                    }
                    className="min-h-9 rounded-full px-3.5 font-semibold text-muted-foreground disabled:opacity-40 aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
                    onClick={() => {
                      setMode(value)
                    }}
                  >
                    {value === 'append' ? 'Add to the list' : 'Replace the list'}
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => void downloadTemplate(surveyId)}>
                <DownloadIcon aria-hidden="true" />
                Download template
              </Button>
            </div>

            <label
              className={cn(
                'mt-3 flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed px-4 py-7 text-center text-muted-foreground hover:border-primary hover:text-primary has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                dragging && 'border-primary bg-primary-soft text-primary-soft-foreground',
              )}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => {
                setDragging(false)
              }}
              onDrop={onDrop}
            >
              {upload.isPending ? (
                <Loader2Icon className="size-6 animate-spin" aria-hidden="true" />
              ) : (
                <UploadIcon className="size-6" aria-hidden="true" />
              )}
              <span className="font-semibold">
                {upload.isPending ? 'Checking the file…' : 'Drop a file here, or choose one'}
              </span>
              <span className="text-xs">.xlsx or .csv, up to 20,000 rows</span>
              <input
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label="Choose an audience file"
                disabled={upload.isPending}
                onChange={(event) => {
                  pickFile(event.target.files?.[0])
                  event.target.value = ''
                }}
              />
            </label>

            {uploadError ? (
              <p
                className="mt-3 flex gap-2 rounded-xl bg-warn-soft px-4 py-3 text-sm font-semibold text-warn"
                role="alert"
              >
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {uploadError}
              </p>
            ) : null}

            {preview ? (
              <UploadPreviewCard
                surveyId={surveyId}
                preview={preview}
                busy={apply.isPending || discard.isPending}
                onApply={() => {
                  apply.mutate(preview.upload_id)
                }}
                onDiscard={() => {
                  discard.mutate(preview.upload_id)
                }}
              />
            ) : null}
          </Panel>

          <Panel
            title="Current audience"
            description={
              data
                ? `${String(data.total)} ${data.total === 1 ? 'person' : 'people'} can respond.`
                : undefined
            }
          >
            {data && data.departments.length > 1 ? (
              <div
                className="mt-3 flex flex-wrap gap-1.5"
                role="group"
                aria-label="Filter by department"
              >
                {data.departments.map((d) => {
                  const value = d.department ?? ''
                  const selected = department === value
                  return (
                    <button
                      key={value || 'none'}
                      type="button"
                      aria-pressed={selected}
                      className="min-h-9 rounded-full border bg-muted px-3 text-sm aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary-soft-foreground"
                      onClick={() => {
                        setDepartment(selected ? null : value)
                        setPage(1)
                      }}
                    >
                      {d.department ?? 'No department'} · {d.count}
                    </button>
                  )
                })}
              </div>
            ) : null}
            <div className="relative mt-3">
              <SearchIcon
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="pl-9"
                placeholder="Search by ID, name or email"
                aria-label="Search the audience"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </div>
            {!data ? (
              <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
            ) : data.items.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {data.total === 0 ? 'No one yet. Upload a file to add people.' : 'No one matches.'}
              </p>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border">
                {data.items.map((member) => (
                  <li key={member.employee_id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {member.name ?? member.employee_id}
                        {member.name ? (
                          <span className="ml-2 text-sm font-normal text-muted-foreground">
                            {member.employee_id}
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {[member.department, member.location, member.email]
                          .filter(Boolean)
                          .join(' · ') || ' '}
                      </p>
                    </div>
                    {member.responded ? (
                      <span className="text-xs text-muted-foreground">Responded</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${member.name ?? member.employee_id}`}
                        title="Remove"
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(member.employee_id)
                        }}
                      >
                        <UserMinusIcon aria-hidden="true" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data && pages > 1 ? (
              <nav
                className="mt-3 flex items-center justify-between text-sm"
                aria-label="Audience pages"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage((p) => p - 1)
                  }}
                >
                  Previous
                </Button>
                <span className="text-muted-foreground">
                  Page {page} of {pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages}
                  onClick={() => {
                    setPage((p) => p + 1)
                  }}
                >
                  Next
                </Button>
              </nav>
            ) : null}
          </Panel>
        </>
      )}
    </>
  )
}

function Stat({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border px-3 py-2.5',
        warn && 'border-transparent bg-warn-soft',
      )}
    >
      <b className={cn('font-heading text-2xl leading-tight', warn && 'text-warn')}>
        {value.toLocaleString()}
      </b>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

function UploadPreviewCard({
  surveyId,
  preview,
  busy,
  onApply,
  onDiscard,
}: {
  surveyId: string
  preview: UploadPreview
  busy: boolean
  onApply: () => void
  onDiscard: () => void
}) {
  return (
    <div className="mt-4" aria-live="polite">
      <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
        <FileSpreadsheetIcon className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <strong className="block truncate">{preview.file_name}</strong>
          <span className="text-sm text-muted-foreground">
            {preview.mode === 'replace'
              ? 'Will replace the current list'
              : 'Will be added to the current list'}
          </span>
        </div>
      </div>
      <div className="my-3.5 grid grid-cols-3 gap-2.5">
        <Stat
          value={preview.valid_count}
          label={preview.mode === 'replace' ? 'Employees' : 'Employees added'}
        />
        <Stat value={preview.duplicate_count} label="Duplicates skipped" />
        <Stat value={preview.error_count} label="Rows to fix" warn={preview.error_count > 0} />
      </div>
      {preview.errors.length ? (
        <>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">Rows to fix</caption>
              <thead className="bg-muted text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Row
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Employee ID
                  </th>
                  <th scope="col" className="px-3 py-2 font-semibold">
                    Problem
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.errors.map((error) => (
                  <tr key={error.row}>
                    <td className="px-3 py-2">{error.row}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {error.employee_id || <span className="text-muted-foreground">Empty</span>}
                    </td>
                    <td className="px-3 py-2">{error.problem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.errors_truncated ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Showing the first {preview.errors.length}. Download the file for all of them.
            </p>
          ) : null}
        </>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onApply} disabled={busy || preview.valid_count === 0}>
          {busy ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
          Apply
        </Button>
        <Button variant="outline" onClick={onDiscard} disabled={busy}>
          Discard
        </Button>
        {preview.error_count ? (
          <Button
            variant="outline"
            onClick={() => void downloadRowsToFix(surveyId, preview.upload_id)}
          >
            <DownloadIcon aria-hidden="true" />
            Download rows to fix
          </Button>
        ) : null}
      </div>
    </div>
  )
}
