/** "42%" from 0.4166. */
export function percent(share: number | null | undefined): string {
  if (share === null || share === undefined) return '–'
  return `${String(Math.round(share * 100))}%`
}

/** 1,284 · 12.9K · 4.2M for tiles and axes. */
export function compact(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export function whole(value: number): string {
  return new Intl.NumberFormat().format(value)
}

/** "4 Nov" from 2026-11-04 (no time-zone shift). */
export function dayMonth(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y ?? 2000, (m ?? 1) - 1, d ?? 1)))
}

export const LOW_RATE = 0.6
