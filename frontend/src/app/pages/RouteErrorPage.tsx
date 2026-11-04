import { TriangleAlertIcon } from 'lucide-react'
import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'

import { NotFoundPage } from './NotFoundPage'

/** Shown when a route fails to load or render, e.g. a lazy chunk after a new deploy. */
export function RouteErrorPage() {
  const error = useRouteError()
  usePageTitle('Something went wrong')

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <NotFoundPage />
      </div>
    )
  }

  if (import.meta.env.DEV) console.error(error)

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <EmptyState
        level={1}
        icon={TriangleAlertIcon}
        title="Something went wrong"
        description="This page couldn't be shown. Reloading usually fixes it."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => {
                window.location.reload()
              }}
            >
              Reload page
            </Button>
            <Button variant="outline" asChild>
              <Link to="/">Go to My surveys</Link>
            </Button>
          </div>
        }
      />
    </div>
  )
}
