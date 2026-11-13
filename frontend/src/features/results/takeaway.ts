import type { ResultsSummary } from './api'
import { percent, whole } from './format'

/** One plain sentence from the data, shown under the survey title. */
export function takeaway(summary: ResultsSummary, filtered: boolean): string {
  const people = summary.respondents === 1 ? 'person has' : 'people have'
  const verb = summary.kind === 'training' ? 'completed it' : 'responded'
  if (summary.respondents === 0) {
    const nobody = summary.kind === 'training' ? 'completed it' : 'responded'
    return filtered ? `Nobody in this group has ${nobody} yet.` : `Nobody has ${nobody} yet.`
  }
  let sentence = `${whole(summary.respondents)} ${people} ${verb}`
  if (summary.response_rate !== null) {
    sentence += `, ${percent(summary.response_rate)} of those invited`
  }
  sentence += '.'
  const average = summary.headline?.average
  if (!summary.small_group && summary.headline && average !== null && average !== undefined) {
    sentence += ` The average answer to “${summary.headline.text.replace(/[?.!]+$/, '')}” is ${average.toFixed(1)} out of 5.`
  }
  return sentence
}
