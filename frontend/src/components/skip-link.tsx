export const MAIN_CONTENT_ID = 'main-content'

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only z-50 rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Skip to main content
    </a>
  )
}
