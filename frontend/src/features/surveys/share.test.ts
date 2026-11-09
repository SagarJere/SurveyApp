import { describe, expect, it } from 'vitest'

import { shortDate } from '@/lib/format'

import { inviteEmail, mailtoHref, surveyLink } from './share'

describe('survey sharing', () => {
  it('builds the respondent link from the site address', () => {
    expect(surveyLink('abc', 'https://pulse.example.com')).toBe('https://pulse.example.com/s/abc')
  })

  it('writes an invitation with the link and the dates', () => {
    const { subject, body } = inviteEmail({
      title: 'Family Unity Run',
      link: 'https://pulse.example.com/s/abc',
      opensAt: '2026-11-20',
      closesAt: '2026-11-30',
      today: '2026-11-09',
    })
    expect(subject).toBe('Survey: Family Unity Run')
    expect(body.split('\r\n')).toEqual([
      'Hello,',
      '',
      'Please take a few minutes to complete the survey “Family Unity Run”:',
      '',
      'https://pulse.example.com/s/abc',
      '',
      `It opens on ${shortDate('2026-11-20')}.`,
      `Please respond by ${shortDate('2026-11-30')}.`,
      '',
      'Thank you.',
    ])
  })

  it('leaves out dates that are past or not set', () => {
    const { body } = inviteEmail({
      title: 'T',
      link: 'L',
      opensAt: '2026-11-01',
      closesAt: null,
      today: '2026-11-09',
    })
    expect(body).not.toContain('opens')
    expect(body).not.toContain('respond by')
    expect(body.endsWith('L\r\n\r\nThank you.')).toBe(true)
  })

  it('encodes the email for a mailto link', () => {
    const href = mailtoHref({ title: 'A & B', link: 'L', opensAt: null, closesAt: null })
    expect(href).toMatch(/^mailto:\?subject=Survey%3A%20A%20%26%20B&body=/)
  })
})
