import type { CSSProperties } from 'react'

import type { Theme } from '@/features/survey-logic/types'

export interface AssetLinks {
  url: string
  mobile_url: string
  width: number
}

/** Look up a theme image by ID. Returns null when the image isn't available. */
export type AssetResolver = (id: string | null) => AssetLinks | null

/**
 * The survey's accent as CSS variables (docs/06-respondent-experience.md, Themes).
 * Accent text is always white; the soft tint mixes with the card colour, so it works in
 * light and dark mode.
 */
export function accentStyle(theme: Theme): CSSProperties {
  return {
    '--survey-accent': theme.accent,
    '--survey-accent-foreground': '#ffffff',
    '--survey-accent-soft': `color-mix(in srgb, ${theme.accent} 16%, var(--card))`,
  } as CSSProperties
}
