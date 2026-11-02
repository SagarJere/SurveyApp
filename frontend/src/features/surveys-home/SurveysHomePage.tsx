import { ClipboardListIcon } from 'lucide-react'

import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { usePageTitle } from '@/hooks/use-page-title'

/** Surveys home for HR and admins. */
export function SurveysHomePage() {
  usePageTitle('Surveys')
  return (
    <>
      <PageHeader title="Surveys" description="Surveys you own, co-own or can view results for." />
      <EmptyState
        icon={ClipboardListIcon}
        title="No surveys yet"
        description="Surveys you create or are added to will appear here with their status and response rates."
      />
    </>
  )
}
