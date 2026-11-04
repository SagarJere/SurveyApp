import { describe, expect, it } from 'vitest'

import type { SurveyListItem } from '@/features/surveys/types'

import { closingSoon, filterSurveys, homeKpis, localToday } from './home-stats'

function item(overrides: Partial<SurveyListItem>): SurveyListItem {
  return {
    id: 'a',
    title: 'Survey',
    status: 'published',
    version_no: 1,
    response_count: 0,
    responses_this_week: 0,
    audience_count: 0,
    response_rate: null,
    opens_at: null,
    closes_at: null,
    has_unpublished_changes: false,
    my_role: 'owner',
    can_edit: true,
    can_delete: false,
    open_to_all: false,
    updated_at: '2026-11-01T00:00:00Z',
    ...overrides,
  }
}

describe('homeKpis', () => {
  it('counts live surveys, sums this week and averages rates of live surveys', () => {
    const kpis = homeKpis([
      item({ response_rate: 0.8, responses_this_week: 10 }),
      item({ response_rate: 0.4, responses_this_week: 5 }),
      item({ open_to_all: true, response_rate: null, responses_this_week: 7 }),
      item({ status: 'closed', response_rate: 1, responses_this_week: 2 }),
      item({ status: 'draft' }),
    ])
    expect(kpis.live).toBe(3)
    expect(kpis.responsesThisWeek).toBe(24)
    expect(kpis.averageRate).toBeCloseTo(0.6)
  })

  it('has no average when no live survey has an invite list', () => {
    expect(homeKpis([item({ status: 'draft' })]).averageRate).toBeNull()
  })
})

describe('closingSoon', () => {
  const today = '2026-11-04'
  it.each([
    ['2026-11-04', 'Closes today'],
    ['2026-11-05', 'Closes tomorrow'],
    ['2026-11-11', 'Closes in 7 days'],
    ['2026-11-12', null],
    ['2026-11-03', null],
  ])('closes_at %s gives %s', (closes, expected) => {
    expect(closingSoon(item({ closes_at: closes }), today)).toBe(expected)
  })

  it('only warns for live surveys', () => {
    expect(closingSoon(item({ status: 'closed', closes_at: today }), today)).toBeNull()
    expect(closingSoon(item({ status: 'draft', closes_at: today }), today)).toBeNull()
  })
})

describe('filterSurveys', () => {
  const list = [
    item({ id: '1', title: 'Workplace pulse', status: 'published' }),
    item({ id: '2', title: 'Canteen feedback', status: 'draft' }),
    item({ id: '3', title: '', status: 'draft' }),
  ]
  it('filters by status and case-insensitive title search', () => {
    expect(filterSurveys(list, 'draft', '').map((s) => s.id)).toEqual(['2', '3'])
    expect(filterSurveys(list, 'all', 'PULSE').map((s) => s.id)).toEqual(['1'])
    expect(filterSurveys(list, 'all', 'untitled').map((s) => s.id)).toEqual(['3'])
  })
})

it('localToday uses the local calendar date', () => {
  expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05')
})
