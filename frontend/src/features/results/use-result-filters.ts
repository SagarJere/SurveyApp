import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import type { ResultFilters } from './api'

export type ResultsTab = 'overview' | 'responses'

/** Filters and the open tab, kept in the URL query string so views can be shared. */
export function useResultFilters() {
  const [params, setParams] = useSearchParams()

  const filters: ResultFilters = useMemo(() => {
    const version = Number(params.get('version'))
    return {
      department: params.get('department'),
      location: params.get('location'),
      from: params.get('from'),
      to: params.get('to'),
      version: Number.isInteger(version) && version > 0 ? version : null,
    }
  }, [params])
  const tab: ResultsTab = params.get('tab') === 'responses' ? 'responses' : 'overview'

  const update = useCallback(
    (patch: Partial<ResultFilters> & { tab?: ResultsTab }) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            // An empty department or location is a real filter ("not recorded"), so keep it.
            const blankDate = (key === 'from' || key === 'to') && value === ''
            if (value === null || blankDate || (key === 'tab' && value === 'overview')) {
              next.delete(key)
            } else {
              next.set(key, String(value))
            }
          }
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const clear = useCallback(() => {
    update({ department: null, location: null, from: null, to: null })
  }, [update])

  const active =
    filters.department !== null || filters.location !== null || !!filters.from || !!filters.to
  return { filters, tab, update, clear, active }
}
