import { NavLink, Outlet } from 'react-router'

import { AppMark } from '@/components/app-mark'
import { canManageSurveys } from '@/features/auth/types'
import { UserMenu } from '@/features/auth/UserMenu'
import { useAuth } from '@/features/auth/use-auth'
import { MAIN_CONTENT_ID, SkipLink } from '@/components/skip-link'
import { cn } from '@/lib/utils'

import { ThemeToggle } from '../theme/ThemeToggle'

const NAV_ITEMS = [
  { to: '/', label: 'My surveys', end: true, managersOnly: false },
  { to: '/admin/surveys', label: 'Surveys', end: false, managersOnly: true },
] as const

/** Shell for signed-in pages: header with role-based navigation, status, theme and account. */
export function AppShell() {
  const { user } = useAuth()
  const items = NAV_ITEMS.filter((item) => !item.managersOnly || canManageSurveys(user))

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
          <AppMark />
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'inline-flex min-h-10 shrink-0 items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3',
                    isActive
                      ? 'bg-primary-soft text-primary-soft-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <UserMenu />
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
