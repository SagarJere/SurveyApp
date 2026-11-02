import { vi } from 'vitest'

import type { Draft } from '@/features/survey-logic/types'
import * as surveysApi from '@/features/surveys/api'
import type { SurveyDetail } from '@/features/surveys/types'

import { sharedCases } from './shared-cases'

export const SURVEY_ID = '11111111-2222-4333-8444-555555555555'

export function pulseDraft(): Draft {
  return structuredClone((sharedCases('workplace-pulse.json') as { draft: Draft }).draft)
}

export function surveyDetail(draft: Draft, overrides: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: SURVEY_ID,
    title: draft.title,
    status: 'draft',
    version_no: null,
    draft,
    draft_updated_at: '2026-11-02T10:00:00.000000+00:00',
    has_unpublished_changes: false,
    open_to_all: false,
    my_role: 'owner',
    can_edit: true,
    can_delete: true,
    created_at: '2026-11-02T09:00:00+00:00',
    updated_at: '2026-11-02T10:00:00+00:00',
    ...overrides,
  }
}

/** Mock the survey API for a builder test. Saves succeed with a new timestamp each time. */
export function mockBuilderApi(draft: Draft, overrides: Partial<SurveyDetail> = {}) {
  let saves = 0
  const getSurvey = vi
    .spyOn(surveysApi, 'getSurvey')
    .mockResolvedValue(surveyDetail(draft, overrides))
  const saveDraft = vi.spyOn(surveysApi, 'saveDraft').mockImplementation(() => {
    saves += 1
    return Promise.resolve({
      draft_updated_at: `2026-11-02T10:00:${String(saves).padStart(2, '0')}+00:00`,
    })
  })
  const validateSurvey = vi.spyOn(surveysApi, 'validateSurvey').mockResolvedValue({ issues: [] })
  return { getSurvey, saveDraft, validateSurvey }
}

/** The draft from the most recent save call. */
export function lastSavedDraft(saveDraft: ReturnType<typeof mockBuilderApi>['saveDraft']): Draft {
  const call = saveDraft.mock.calls.at(-1)
  if (!call) throw new Error('No save happened')
  return call[1]
}
