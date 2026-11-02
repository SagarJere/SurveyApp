import { QueryClient } from '@tanstack/react-query'

import { ApiError } from './api'

const MAX_RETRIES = 2

/** Retry only failures that might succeed next time: network errors and 5xx, not 4xx. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false
  if (error instanceof ApiError) return error.isNetworkError || error.isServerError
  return false
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}
