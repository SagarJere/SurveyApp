import { Outlet } from 'react-router'

import { AppMark } from '@/components/app-mark'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/skip-link'

import { ThemeToggle } from '../theme/ThemeToggle'

/**
 * Minimal, distraction-free shell for taking a survey. Lazy-loaded with the respondent routes
 * so people answering on a phone don't download the builder or dashboards.
 */
export function RespondentLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4">
          <AppMark />
          <ThemeToggle />
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 outline-none sm:py-10"
      >
        <Outlet />
      </main>
    </div>
  )
}
