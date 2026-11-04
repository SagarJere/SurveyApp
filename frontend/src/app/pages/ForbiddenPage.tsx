import { ShieldOffIcon } from 'lucide-react'
import { Link } from 'react-router'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { usePageTitle } from '@/hooks/use-page-title'

export function ForbiddenPage() {
  usePageTitle('No access')
  return (
    <EmptyState
      level={1}
      icon={ShieldOffIcon}
      title="You don't have access to this page"
      description="It's only for HR and admin users. If you need access, contact HR."
      action={
        <Button asChild>
          <Link to="/">Go to My surveys</Link>
        </Button>
      }
    />
  )
}
