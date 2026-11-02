import { LockIcon } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'

/** `/s/:surveyId` when the survey can't be shown to this person. */
export function SurveyUnavailablePage() {
  usePageTitle('Survey not available')
  return (
    <EmptyState
      icon={LockIcon}
      title="This survey isn't available to you."
      description="If you think that's a mistake, contact HR."
      action={
        <Button variant="outline" asChild>
          <Link to="/">Go to My surveys</Link>
        </Button>
      }
    />
  )
}
