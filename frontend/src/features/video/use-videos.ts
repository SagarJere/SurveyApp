import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { FormVideo } from '@/features/respond/form/SurveyForm'
import type { Section } from '@/features/survey-logic/types'
import { listVideos, surveyKeys } from '@/features/surveys/api'
import type { VideoAsset } from '@/features/surveys/types'

/** A training's uploaded videos (with signed links), keyed by id. */
export function useUploadedVideos(surveyId: string, enabled = true) {
  const query = useQuery({
    queryKey: surveyKeys.videos(surveyId),
    queryFn: ({ signal }) => listVideos(surveyId, signal),
    enabled: enabled && surveyId !== '',
    // Signed links last about a day; refresh well before that while the builder stays open.
    staleTime: 60 * 60 * 1000,
  })
  const byId = useMemo(
    () => new Map<string, VideoAsset>((query.data ?? []).map((v) => [v.id, v])),
    [query.data],
  )
  return { ...query, byId }
}

/** The draft's section videos, ready for the form (Preview). Unfinished ones are left out. */
export function useDraftVideos(
  surveyId: string,
  sections: Section[],
  enabled: boolean,
): Record<string, FormVideo> {
  const { byId } = useUploadedVideos(surveyId, enabled)
  return useMemo(() => {
    const out: Record<string, FormVideo> = {}
    if (!enabled) return out
    for (const section of sections) {
      const video = section.video
      if (!video) continue
      const url =
        video.source === 'upload'
          ? video.asset_id
            ? byId.get(video.asset_id)?.url
            : undefined
          : video.url?.trim()
      if (url) {
        out[section.key] = { url, allow_seek: video.allow_seek, allow_speed: video.allow_speed }
      }
    }
    return out
  }, [byId, enabled, sections])
}
