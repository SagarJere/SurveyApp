import { QueryClient } from '@tanstack/react-query'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'

import { AppProviders } from '@/app/providers'
import { routes } from '@/app/router'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  queryClient: QueryClient = createTestQueryClient(),
): RenderResult & { queryClient: QueryClient } {
  const result = render(<AppProviders queryClient={queryClient}>{ui}</AppProviders>)
  return { ...result, queryClient }
}

export function renderRoute(path: string, queryClient: QueryClient = createTestQueryClient()) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
  return { ...result, router, queryClient }
}
