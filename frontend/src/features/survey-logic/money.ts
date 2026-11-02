/**
 * Money formatting and amount in words. Mirrors backend/app/services/money.py.
 * Both must give identical output for every case in shared/test-cases/money.json.
 */
import type { Currency } from './types'

export const MAX_INTEGER_DIGITS = 13
export const MAX_AMOUNT = 9_999_999_999_999.99

interface CurrencyInfo {
  symbol: string
  major: [string, string]
  minor: [string, string]
  indianGrouping?: boolean
  addOnly?: boolean
  spaceAfterSymbol?: boolean
}

export const CURRENCIES: Record<Currency, CurrencyInfo> = {
  INR: {
    symbol: '₹',
    major: ['rupee', 'rupees'],
    minor: ['paisa', 'paise'],
    indianGrouping: true,
    addOnly: true,
  },
  USD: { symbol: '$', major: ['dollar', 'dollars'], minor: ['cent', 'cents'] },
  EUR: { symbol: '€', major: ['euro', 'euros'], minor: ['cent', 'cents'] },
  GBP: { symbol: '£', major: ['pound', 'pounds'], minor: ['penny', 'pence'] },
  AED: {
    symbol: 'AED',
    major: ['dirham', 'dirhams'],
    minor: ['fils', 'fils'],
    spaceAfterSymbol: true,
  },
}

export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[]

/** Split an amount into whole units and paise/cents, rounding to 2 decimals. */
function splitAmount(value: number): [number, number] {
  if (!Number.isFinite(value) || value < 0) throw new RangeError("Amounts can't be negative")
  if (value > MAX_AMOUNT) {
    throw new RangeError(
      `Amounts can't have more than ${MAX_INTEGER_DIGITS} digits before the decimal point`,
    )
  }
  const [whole = '0', fraction = '00'] = value.toFixed(2).split('.')
  return [Number(whole), Number(fraction)]
}

/** '1234567' -> '12,34,567' (Indian) or '1,234,567' (international). */
export function groupDigits(digits: string, indian: boolean): string {
  if (indian && digits.length > 3) {
    const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
    return `${head},${digits.slice(-3)}`
  }
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function withSymbol(text: string, currency: Currency): string {
  const info = CURRENCIES[currency]
  return `${info.symbol}${info.spaceAfterSymbol ? ' ' : ''}${text}`
}

/** ₹1,25,000 · ₹12,34,567.50 · $1,234,567 · AED 1,500. Paise/cents shown only when present. */
export function formatAmount(value: number, currency: Currency): string {
  const [whole, fraction] = splitAmount(value)
  const text = groupDigits(String(whole), CURRENCIES[currency].indianGrouping ?? false)
  return withSymbol(fraction ? `${text}.${String(fraction).padStart(2, '0')}` : text, currency)
}

const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
]
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function under100(n: number): string {
  if (n < 20) return ONES[n] ?? ''
  const tens = TENS[Math.floor(n / 10)] ?? ''
  return n % 10 ? `${tens}-${ONES[n % 10] ?? ''}` : tens
}

function under1000(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  return [hundreds ? `${ONES[hundreds] ?? ''} hundred` : '', rest ? under100(rest) : '']
    .filter(Boolean)
    .join(' ')
}

function indianWords(n: number): string {
  if (n === 0) return 'zero'
  const crore = Math.floor(n / 10_000_000)
  const lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1000)
  const rest = n % 1000
  return [
    crore ? `${indianWords(crore)} crore` : '',
    lakh ? `${under100(lakh)} lakh` : '',
    thousand ? `${under100(thousand)} thousand` : '',
    rest ? under1000(rest) : '',
  ]
    .filter(Boolean)
    .join(' ')
}

const SCALES: [number, string][] = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
]

function internationalWords(n: number): string {
  if (n === 0) return 'zero'
  const parts: string[] = []
  let remaining = n
  for (const [size, name] of SCALES) {
    const count = Math.floor(remaining / size)
    if (count) {
      parts.push(`${under1000(count)} ${name}`)
      remaining -= count * size
    }
  }
  if (remaining) parts.push(under1000(remaining))
  return parts.join(' ')
}

/** 'One lakh twenty-five thousand rupees only' · 'One million dollars and five cents'. */
export function amountInWords(value: number, currency: Currency): string {
  const info = CURRENCIES[currency]
  const [major, minor] = splitAmount(value)
  const toWords = info.indianGrouping ? indianWords : internationalWords
  let text = `${toWords(major)} ${major === 1 ? info.major[0] : info.major[1]}`
  if (minor) text += ` and ${toWords(minor)} ${minor === 1 ? info.minor[0] : info.minor[1]}`
  if (info.addOnly) text += ' only'
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export interface AmountInputResult {
  /** What the input shows: grouped digits, e.g. "12,34,567.5". */
  display: string
  /** The number typed, or null when the field is empty. */
  value: number | null
  /** Where the caret goes in `display`. */
  caret: number
}

/**
 * Format an amount while the person types, keeping the caret after the same digit.
 * Accepts digits and one decimal point (only when decimals are allowed, max 2 places).
 * At most 13 digits before the decimal point.
 */
export function formatAmountInput(
  raw: string,
  caret: number,
  currency: Currency,
  allowDecimals: boolean,
): AmountInputResult {
  const significantBefore = raw.slice(0, caret).replace(/[^\d.]/g, '').length
  let cleaned = raw.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  if (dot >= 0) {
    cleaned = allowDecimals
      ? `${cleaned.slice(0, dot + 1)}${cleaned
          .slice(dot + 1)
          .replace(/\./g, '')
          .slice(0, 2)}`
      : cleaned.slice(0, dot)
  }
  const [rawWhole = '', fraction] = cleaned.split('.')
  const whole = rawWhole.replace(/^0+(?=\d)/, '').slice(0, MAX_INTEGER_DIGITS)
  const normalised = fraction === undefined ? whole : `${whole || '0'}.${fraction}`
  if (!normalised) return { display: '', value: null, caret: 0 }

  const grouped = groupDigits(whole || '0', CURRENCIES[currency].indianGrouping ?? false)
  const display = fraction === undefined ? grouped : `${grouped}.${fraction}`

  const wanted = Math.min(significantBefore, normalised.length)
  let position = 0
  let seen = 0
  while (position < display.length && seen < wanted) {
    if (/[\d.]/.test(display.charAt(position))) seen += 1
    position += 1
  }
  const value = normalised === '.' ? null : Number(normalised)
  return { display, value: Number.isFinite(value) ? value : null, caret: position }
}

/** Show a stored amount in an input: grouped, without the symbol. */
export function amountInputDisplay(value: number | null, currency: Currency): string {
  if (value === null) return ''
  const [whole, fraction] = splitAmount(value)
  const grouped = groupDigits(String(whole), CURRENCIES[currency].indianGrouping ?? false)
  return fraction ? `${grouped}.${String(fraction).padStart(2, '0')}` : grouped
}
