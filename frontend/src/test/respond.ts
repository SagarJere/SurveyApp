import { vi } from 'vitest'

import * as respondApi from '@/features/respond/api'
import { ApiError } from '@/lib/api'

export const NOT_AVAILABLE =
  "This survey isn't available to you. If you think that's a mistake, contact HR."

/** Default respondent API for route tests: nothing to take, and survey links refused. */
export function mockRespondDefaults() {
  vi.spyOn(respondApi, 'listMySurveys').mockResolvedValue([])
  vi.spyOn(respondApi, 'getRespondentSurvey').mockRejectedValue(
    new ApiError({ status: 403, code: 'NOT_IN_AUDIENCE', message: NOT_AVAILABLE }),
  )
}
