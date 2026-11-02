import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { Toaster } from '@/components/ui/sonner'
import { configureApiHandlers } from '@/lib/api'
import { createQueryClient } from '@/lib/query-client'

import type { AppRouter } from './router'
import { ThemeProvider } from './theme/ThemeProvider'

interface AppProvidersProps {
  children: ReactNode
  /** When given, a 401 navigates inside the SPA instead of reloading the page. */
  router?: AppRouter
  queryClient?: QueryClient
}

export function AppProviders({ children, router, queryClient }: AppProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient())

  useEffect(() => {
    if (!router) return undefined
    return configureApiHandlers({
      onUnauthorized: () => {
        client.clear()
        const { pathname, search } = router.state.location
        if (pathname === '/login') return
        void router.navigate(`/login?next=${encodeURIComponent(`${pathname}${search}`)}`, {
          replace: true,
        })
      },
    })
  }, [router, client])

  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        {children}
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  )
}
