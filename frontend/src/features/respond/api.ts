import type { Answers, Draft, Theme } from '@/features/survey-logic/types'
import { api } from '@/lib/api'

import type { AssetLinks } from './form/theme-utils'

export interface RespondentParticipation {
  status: 'not_started' | 'in_progress' | 'submitted'
  answers: Answers
  can_edit: boolean
  can_respond_again: boolean
  /** The survey changed since this draft was saved; answers were kept where possible. */
  draft_updated: boolean
}

/** A training section's video, ready to play. */
export interface PlayableVideo {
  url: string
  allow_seek: boolean
  allow_speed: boolean
  duration_seconds: number | null
}

export interface VideoProgress {
  furthest_seconds: number
  completed: boolean
}

export interface RespondentSurvey extends Pick<
  Draft,
  'title' | 'description' | 'settings' | 'theme' | 'sections' | 'questions'
> {
  survey_id: string
  kind: 'survey' | 'training'
  version_no: number
  assets: Record<string, AssetLinks>
  /** Trainings: section key -> its video, and how far this person got in each. */
  videos: Record<string, PlayableVideo>
  video_progress: Record<string, VideoProgress>
  participation: RespondentParticipation
}

export interface SubmitResult {
  status: 'submitted'
  submitted_at: string
  can_edit: boolean
  can_respond_again: boolean
}

export interface MySurvey {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'submitted'
  open: boolean
  closes_at: string | null
  minutes: number
  progress: number | null
  accent: Theme['accent']
  cover: AssetLinks | null
  submitted_at: string | null
  /** Trainings: section videos, and how many this person has finished. */
  videos_total: number
  videos_done: number
}

export const respondKeys = {
  mine: ['me', 'surveys'] as const,
  trainings: ['me', 'trainings'] as const,
  survey: (id: string) => ['respond', id] as const,
}

export async function listMySurveys(signal?: AbortSignal): Promise<MySurvey[]> {
  return (await api.get<MySurvey[]>('/me/surveys', { signal })).data
}

export async function listMyTrainings(signal?: AbortSignal): Promise<MySurvey[]> {
  return (await api.get<MySurvey[]>('/me/trainings', { signal })).data
}

/** Save how far someone got in a section's video (quietly: the player retries next time). */
export async function saveVideoProgress(
  id: string,
  sectionKey: string,
  furthestSeconds: number,
  completed: boolean,
): Promise<VideoProgress> {
  return (
    await api.put<VideoProgress>(
      `/respond/${id}/videos/${sectionKey}`,
      { furthest_seconds: Math.floor(furthestSeconds), completed },
      { skipErrorToast: true },
    )
  ).data
}

export async function getRespondentSurvey(
  id: string,
  signal?: AbortSignal,
): Promise<RespondentSurvey> {
  // Access problems (not in the audience, closed) are shown as full-page messages.
  return (await api.get<RespondentSurvey>(`/respond/${id}`, { signal, skipErrorToast: true })).data
}

export async function saveRespondentDraft(
  id: string,
  answers: Answers,
): Promise<{ saved_at: string }> {
  return (
    await api.put<{ saved_at: string }>(
      `/respond/${id}/draft`,
      { answers },
      { skipErrorToast: true },
    )
  ).data
}

export async function submitAnswers(id: string, answers: Answers): Promise<SubmitResult> {
  return (
    await api.post<SubmitResult>(`/respond/${id}/submit`, { answers }, { skipErrorToast: true })
  ).data
}
