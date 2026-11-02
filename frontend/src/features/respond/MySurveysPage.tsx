import { PartyPopperIcon } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { usePageTitle } from '@/hooks/use-page-title'

/** "My surveys": the surveys an employee can take. */
export function MySurveysPage() {
  usePageTitle('My surveys')
  return (
    <>
      <PageHeader title="My surveys" description="Surveys you've been invited to take." />
      <EmptyState
        icon={PartyPopperIcon}
        title="You're all caught up."
        description="When HR sends you a survey, it will appear here."
      />
    </>
  )
}
