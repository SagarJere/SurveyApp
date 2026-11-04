import { useInfiniteQuery } from '@tanstack/react-query'
import { Loader2Icon, SearchIcon } from 'lucide-react'
import { useEffect, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { shortDate } from '@/lib/format'

import { getComments, resultKeys, type QuestionResult, type ResultFilters } from './api'
import { whole } from './format'

function useDebounced<T>(value: T, delay = 300): T {
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

interface CommentsListProps {
  surveyId: string
  filters: ResultFilters
  question: QuestionResult
}

/** "N of M people left a comment", a search box, and the comments, 20 at a time. */
export function CommentsList({ surveyId, filters, question }: CommentsListProps) {
  const id = useId()
  const [search, setSearch] = useState('')
  const term = useDebounced(search.trim())
  const comments = useInfiniteQuery({
    queryKey: resultKeys.part(surveyId, 'comments', filters, { q: question.key, term }),
    queryFn: ({ pageParam, signal }) =>
      getComments(
        surveyId,
        filters,
        { question_key: question.key, search: term || undefined, page: pageParam },
        signal,
      ),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.page_size < last.total ? last.page + 1 : undefined,
  })
  const items = comments.data?.pages.flatMap((p) => p.items) ?? []
  const total = comments.data?.pages[0]?.total ?? 0

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {whole(question.answered)} of {whole(question.shown)}{' '}
        {question.shown === 1 ? 'person' : 'people'} left a comment.
      </p>
      {question.answered > 0 ? (
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <label htmlFor={`${id}-search`} className="sr-only">
            Search comments for question {question.number}
          </label>
          <Input
            id={`${id}-search`}
            type="search"
            className="pl-9"
            placeholder="Search comments"
            maxLength={100}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
            }}
          />
        </div>
      ) : null}
      {comments.isPending ? (
        <div className="flex flex-col gap-2" aria-label="Loading comments">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : comments.isError ? (
        <p className="text-sm text-destructive">
          We couldn&apos;t load the comments. Try again later.
        </p>
      ) : items.length === 0 ? (
        question.answered > 0 ? (
          <p className="text-sm text-muted-foreground" role="status">
            {term ? `No comments mention “${term}”.` : 'No comments in this group.'}
          </p>
        ) : null
      ) : (
        <>
          {term ? (
            <p className="text-sm text-muted-foreground" role="status">
              {whole(total)} {total === 1 ? 'comment mentions' : 'comments mention'} “{term}”.
            </p>
          ) : null}
          {/* A scrolling box must take keyboard focus so it can be scrolled without a mouse. */}
          <div
            role="region"
            aria-label={`Comments for question ${String(question.number)}`}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            className="max-h-96 overflow-y-auto rounded-lg focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ul className="flex flex-col gap-2">
              {items.map((item, index) => (
                <li
                  key={`${item.submitted_on}-${String(index)}`}
                  className="rounded-lg border bg-background p-3"
                >
                  <p className="text-sm break-words whitespace-pre-line">{item.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      item.employee ? (item.employee.name ?? item.employee.employee_id) : null,
                      item.department ?? 'Department not recorded',
                      item.location,
                      shortDate(item.submitted_on),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          {comments.hasNextPage ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={comments.isFetchingNextPage}
              onClick={() => {
                void comments.fetchNextPage()
              }}
            >
              {comments.isFetchingNextPage ? (
                <Loader2Icon className="animate-spin" aria-hidden="true" />
              ) : null}
              Show more comments
            </Button>
          ) : null}
        </>
      )}
    </div>
  )
}
