import { CompassIcon } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'

export function NotFoundPage() {
  usePageTitle('Page not found')
  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      description="The link may be wrong, or the page may have moved."
      action={
        <Button asChild>
          <Link to="/">Go to My surveys</Link>
        </Button>
      }
    />
  )
}
