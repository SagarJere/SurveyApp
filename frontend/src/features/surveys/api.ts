import { api } from '@/lib/api'
import type { Draft } from '@/features/survey-logic/types'

import type { SurveyDetail, SurveyListItem, ValidateResponse } from './types'

export const surveyKeys = {
  all: ['surveys'] as const,
  detail: (id: string) => ['survey', id] as const,
}

export async function listSurveys(signal?: AbortSignal): Promise<SurveyListItem[]> {
  return (await api.get<SurveyListItem[]>('/surveys', { signal })).data
}

export async function createSurvey(): Promise<SurveyDetail> {
  return (await api.post<SurveyDetail>('/surveys')).data
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
