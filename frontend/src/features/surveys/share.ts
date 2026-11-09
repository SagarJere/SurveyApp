import { shortDate } from '@/lib/format'

/** The link employees open to take a survey. */
export function surveyLink(surveyId: string, origin: string = window.location.origin): string {
  return `${origin}/s/${surveyId}`
}

export interface ShareDetails {
  title: string
  link: string
  opensAt: string | null
  closesAt: string | null
  today?: string
}

/** Subject and body for an email inviting people to take the survey. */
export function inviteEmail({ title, link, opensAt, closesAt, today }: ShareDetails): {
  subject: string
  body: string
} {
  const lines = [
    'Hello,',
    '',
    `Please take a few minutes to complete the survey “${title}”:`,
    '',
    link,
    '',
  ]
  const now = today ?? new Date().toISOString().slice(0, 10)
  if (opensAt && opensAt > now) lines.push(`It opens on ${shortDate(opensAt)}.`)
  if (closesAt) lines.push(`Please respond by ${shortDate(closesAt)}.`)
  if (lines.at(-1) !== '') lines.push('')
  lines.push('Thank you.')
  return { subject: `Survey: ${title}`, body: lines.join('\r\n') }
}

export function mailtoHref(details: ShareDetails): string {
  const { subject, body } = inviteEmail(details)
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
