import { LogOutIcon } from 'lucide-react'
import { useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { ROLE_LABELS, type AuthUser } from './types'
import { useAuth } from './use-auth'

function initials(user: AuthUser): string {
  const name = user.name?.trim()
  const source = name !== undefined && name.length > 0 ? name : user.employee_id
  const parts = source.split(/\s+/).filter(Boolean)
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts.at(-1)?.[0] ?? ''}` : source.slice(0, 2)
  return letters.toUpperCase()
}

export function UserMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  if (!user) return null

  const displayName = user.name ?? user.employee_id

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="gap-2 px-1.5 sm:px-2"
          aria-label={`Account: ${displayName}`}
        >
          <span
            className="grid size-8 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary"
            aria-hidden="true"
          >
            {initials(user)}
          </span>
          <span className="hidden max-w-36 truncate md:inline" aria-hidden="true">
            {displayName}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate">{displayName}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {user.employee_id} · {ROLE_LABELS[user.role]}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            signOut()
            void navigate('/login', { replace: true })
          }}
        >
          <LogOutIcon aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
