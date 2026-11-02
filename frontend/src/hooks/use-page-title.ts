import { useEffect } from 'react'

import { env } from '@/lib/env'

/** Set the browser tab title. Screen readers announce it on route changes. */
export function usePageTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${env.appName}` : env.appName
  }, [title])
}
