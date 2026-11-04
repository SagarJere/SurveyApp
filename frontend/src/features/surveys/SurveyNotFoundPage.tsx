import { SearchXIcon } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'

/** Builder or results link for a survey that doesn't exist or isn't shared with this user. */
export function SurveyNotFoundPage() {
  usePageTitle('Survey not found')
  return (
    <EmptyState
      level={1}
      icon={SearchXIcon}
      title="We couldn't find that survey"
      description="It may have been deleted, or it hasn't been shared with you."
      action={
        <Button variant="outline" asChild>
          <Link to="/admin/surveys">Back to Surveys</Link>
        </Button>
      }
    />
  )
}
