import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import type { AssetResolver } from '@/features/respond/form/theme-utils'
import { listGallery, listUploads, surveyKeys } from '@/features/surveys/api'
import type { ThemeAsset } from '@/features/surveys/types'

// Image links are signed for about a day; refresh well before that.
const STALE_MS = 60 * 60 * 1000

/** The company gallery and this survey's uploads, plus a lookup for rendering the theme. */
export function useThemeAssets(surveyId: string) {
  const gallery = useQuery({
    queryKey: surveyKeys.gallery,
    queryFn: ({ signal }) => listGallery(signal),
    staleTime: STALE_MS,
  })
  const uploads = useQuery({
    queryKey: surveyKeys.uploads(surveyId),
    queryFn: ({ signal }) => listUploads(surveyId, signal),
    staleTime: STALE_MS,
  })

  const byId = useMemo(() => {
    const all: ThemeAsset[] = [...(gallery.data ?? []), ...(uploads.data ?? [])]
    return new Map(all.map((asset) => [asset.id, asset]))
  }, [gallery.data, uploads.data])

  const resolve: AssetResolver = useCallback((id) => (id ? (byId.get(id) ?? null) : null), [byId])

  return {
    gallery: gallery.data ?? [],
    uploads: uploads.data ?? [],
    loading: gallery.isPending || uploads.isPending,
    failed: gallery.isError || uploads.isError,
    resolve,
  }
}
