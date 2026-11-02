import { useQuery } from '@tanstack/react-query'

import { fetchHealth } from './api'

export const healthQueryKey = ['health'] as const

export const HEALTH_REFRESH_MS = 30_000

export function useHealth() {
  return useQuery({
    queryKey: healthQueryKey,
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: HEALTH_REFRESH_MS,
    staleTime: 10_000,
    retry: 1,
  })
}
