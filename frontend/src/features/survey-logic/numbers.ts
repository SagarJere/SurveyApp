/**
 * Number questions: limits, display, range checks and parsing what people type.
 * Mirrors backend/app/services/numbers.py; both pass shared/test-cases/number.json.
 *
 * Answers are stored as numeric(14,2): at most 12 digits before the decimal point, 2 after.
 */
import { groupDigits } from './money'
import type { NumberConfig } from './types'

export const MAX_NUMBER = 999_999_999_999.99
export const MAX_NUMBER_DIGITS = 12
export const MAX_UNIT_LENGTH = 30

export const DEFAULT_NUMBER_CONFIG: NumberConfig = {
  number_min: 0,
  number_max: null,
  number_decimals: false,
  number_unit: '',
}

/** 12,34,567 · 2.5 · -1,234.75 · "3 people". Up to 2 decimals, trailing zeros dropped. */
export function formatNumber(value: number, unit?: string | null): string {
  const rounded = Math.round(Math.abs(value) * 100) / 100
  const [whole = '0', fraction = ''] = rounded.toFixed(2).split('.')
  const trimmed = fraction.replace(/0+$/, '')
  const sign = value < 0 && rounded !== 0 ? '-' : ''
  const text = `${sign}${groupDigits(whole, true)}${trimmed ? `.${trimmed}` : ''}`
  const label = unit?.trim()
  return label ? `${text} ${label}` : text
}

function limit(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** "Enter a number from 1 to 10." / "Enter at least 1." / "Enter 10 or less." — or null. */
export function numberRangeError(
  config: Partial<NumberConfig> | Record<string, unknown>,
  value: number,
): string | null {
  const low = limit(config.number_min)
  const high = limit(config.number_max)
  if ((low === null || value >= low) && (high === null || value <= high)) return null
  if (low !== null && high !== null) {
    return `Enter a number from ${formatNumber(low)} to ${formatNumber(high)}.`
  }
  if (low !== null) return `Enter at least ${formatNumber(low)}.`
  return `Enter ${formatNumber(high ?? 0)} or less.`
}

export interface NumberInputRules {
  decimals: boolean
  negative: boolean
}

/**
 * Read what someone typed. Returns null when the text can't become a number this question
 * accepts (the keystroke is then ignored), otherwise the cleaned text and its value
 * (null while it's empty or just "-" or ".").
 */
export function parseNumberInput(
  raw: string,
  rules: NumberInputRules,
): { text: string; value: number | null } | null {
  const text = raw.replace(/[,\s]/g, '')
  const pattern = rules.decimals ? /^-?\d*(\.\d{0,2})?$/ : /^-?\d*$/
  if (!pattern.test(text)) return null
  if (!rules.negative && text.startsWith('-')) return null
  const digits = text.replace(/^-/, '').split('.')[0] ?? ''
  if (digits.replace(/^0+(?=\d)/, '').length > MAX_NUMBER_DIGITS) return null
  if (text === '' || text === '-' || text === '.' || text === '-.') return { text, value: null }
  return { text, value: Number(text) }
}
