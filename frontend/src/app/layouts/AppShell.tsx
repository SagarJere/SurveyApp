import { NavLink, Outlet } from 'react-router'

import { AppMark } from '@/components/app-mark'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/skip-link'
import { HealthStatus } from '@/features/health/HealthStatus'
import { cn } from '@/lib/utils'

import { ThemeToggle } from '../theme/ThemeToggle'

const NAV_ITEMS = [
  { to: '/', label: 'My surveys', end: true },
  { to: '/admin/surveys', label: 'Surveys', end: false },
] as const

/** Shell for signed-in pages: header with navigation, connection status and theme menu. */
export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <AppMark />
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            <HealthStatus />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8"
      >
        <Outlet />
      </main>
    </div>
  )
}
