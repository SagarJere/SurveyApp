import { api } from '@/lib/api'
import type { Draft } from '@/features/survey-logic/types'

import type {
  CloseResponse,
  PublishResponse,
  SurveyDetail,
  SurveyKind,
  SurveyListItem,
  ThemeAsset,
  ValidateResponse,
  VideoAsset,
} from './types'

export const surveyKeys = {
  all: ['surveys'] as const,
  list: (kind: SurveyKind) => ['surveys', kind] as const,
  videos: (id: string) => ['survey', id, 'videos'] as const,
  detail: (id: string) => ['survey', id] as const,
  uploads: (id: string) => ['survey', id, 'theme-assets'] as const,
  gallery: ['theme-assets', 'gallery'] as const,
}

export async function listSurveys(
  kind: SurveyKind = 'survey',
  signal?: AbortSignal,
): Promise<SurveyListItem[]> {
  return (await api.get<SurveyListItem[]>('/surveys', { params: { kind }, signal })).data
}

export async function createSurvey(kind: SurveyKind = 'survey'): Promise<SurveyDetail> {
  return (await api.post<SurveyDetail>('/surveys', { kind })).data
}

export async function getSurvey(id: string, signal?: AbortSignal): Promise<SurveyDetail> {
  return (await api.get<SurveyDetail>(`/surveys/${id}`, { signal })).data
}

export async function saveDraft(
  id: string,
  draft: Draft,
  draftUpdatedAt: string,
): Promise<{ draft_updated_at: string }> {
  return (
    await api.put<{ draft_updated_at: string }>(
      `/surveys/${id}/draft`,
      { draft, draft_updated_at: draftUpdatedAt },
      // The builder shows its own save status; a failed autosave shouldn't toast every time.
      { skipErrorToast: true },
    )
  ).data
}

export async function validateSurvey(id: string): Promise<ValidateResponse> {
  return (await api.post<ValidateResponse>(`/surveys/${id}/validate`)).data
}

export async function duplicateSurvey(id: string): Promise<SurveyDetail> {
  return (await api.post<SurveyDetail>(`/surveys/${id}/duplicate`)).data
}

export async function deleteSurvey(id: string): Promise<void> {
  await api.delete(`/surveys/${id}`)
}

export async function publishSurvey(id: string): Promise<PublishResponse> {
  // Validation problems come back as a 422 the builder shows itself.
  return (await api.post<PublishResponse>(`/surveys/${id}/publish`)).data
}

export async function closeSurvey(id: string): Promise<CloseResponse> {
  return (await api.post<CloseResponse>(`/surveys/${id}/close`)).data
}

export async function listGallery(signal?: AbortSignal): Promise<ThemeAsset[]> {
  return (await api.get<ThemeAsset[]>('/theme-assets/gallery', { signal })).data
}

export async function listUploads(id: string, signal?: AbortSignal): Promise<ThemeAsset[]> {
  return (await api.get<ThemeAsset[]>(`/surveys/${id}/theme-assets`, { signal })).data
}

export async function uploadThemeAsset(id: string, file: File): Promise<ThemeAsset> {
  const form = new FormData()
  form.append('file', file)
  // The Theme tab shows upload problems next to the tiles.
  return (await api.post<ThemeAsset>(`/surveys/${id}/theme-assets`, form, { skipErrorToast: true }))
    .data
}

export async function listVideos(id: string, signal?: AbortSignal): Promise<VideoAsset[]> {
  return (await api.get<VideoAsset[]>(`/surveys/${id}/videos`, { signal })).data
}

/** Upload a training video. `onProgress` gets 0–1 as the file goes up. */
export async function uploadVideo(
  id: string,
  file: File,
  durationSeconds: number | null,
  onProgress?: (fraction: number) => void,
): Promise<VideoAsset> {
  const form = new FormData()
  form.append('file', file)
  if (durationSeconds !== null) form.append('duration_seconds', String(Math.round(durationSeconds)))
  return (
    await api.post<VideoAsset>(`/surveys/${id}/videos`, form, {
      // The video panel shows upload problems next to the file.
      skipErrorToast: true,
      // Large files: no request timeout while uploading.
      timeout: 0,
      onUploadProgress: (event) => {
        if (event.total) onProgress?.(event.loaded / event.total)
      },
    })
  ).data
}

export async function deleteVideo(id: string, videoId: string): Promise<void> {
  await api.delete(`/surveys/${id}/videos/${videoId}`)
}
