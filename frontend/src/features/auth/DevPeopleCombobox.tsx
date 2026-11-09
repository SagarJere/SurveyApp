import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, Loader2Icon } from 'lucide-react'
import { useEffect, useState, type InputHTMLAttributes, type Ref } from 'react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

import { fetchDevPeople, type DevPerson } from './api'
import { ROLE_LABELS } from './types'

function useDebounced<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delay)
    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delay])
  return debounced
}

interface DevPeopleComboboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'role'
> {
  id: string
  value: string
  inputRef: Ref<HTMLInputElement>
  /** Someone was picked from the list. */
  onPick: (employeeId: string) => void
}

/**
 * Dev sign-in only: the employee ID field doubles as a searchable list of everyone you can sign
 * in as (test accounts, HR/admin users and every survey audience). Typing any other ID still works.
 */
export function DevPeopleCombobox({
  id,
  value,
  inputRef,
  onPick,
  onChange,
  onBlur,
  onKeyDown,
  disabled,
  className,
  ...inputProps
}: DevPeopleComboboxProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const term = useDebounced(value.trim())
  const people = useQuery({
    queryKey: ['auth', 'dev-people', term],
    queryFn: ({ signal }) => fetchDevPeople(term, signal),
    enabled: open,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
  const items = people.data?.items ?? []
  const total = people.data?.total ?? 0
  const listId = `${id}-people`
  const optionId = (index: number) => `${id}-person-${String(index)}`

  // A new search starts from the top of the list.
  const [searched, setSearched] = useState(term)
  if (searched !== term) {
    setSearched(term)
    setActive(-1)
  }

  useEffect(() => {
    if (active < 0) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // optionId only depends on id, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const pick = (person: DevPerson) => {
    setOpen(false)
    setActive(-1)
    onPick(person.employee_id)
  }

  const expanded = open && !disabled

  return (
    <div className="relative">
      <Input
        {...inputProps}
        id={id}
        ref={inputRef}
        value={value}
        disabled={disabled}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        className={cn('pr-10', className)}
        onClick={() => {
          setOpen(true)
        }}
        onChange={(event) => {
          setOpen(true)
          onChange?.(event)
        }}
        onBlur={(event) => {
          setOpen(false)
          onBlur?.(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!open) setOpen(true)
            else setActive((i) => Math.min(i + 1, items.length - 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (event.key === 'Enter' && expanded && active >= 0 && items[active]) {
            // Enter on a highlighted person signs in as them; otherwise it submits the typed ID.
            event.preventDefault()
            pick(items[active])
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            setOpen(false)
          }
          onKeyDown?.(event)
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        className="absolute top-1/2 right-1 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        // Keep focus in the field so the list doesn't close before it opens.
        onMouseDown={(event) => {
          event.preventDefault()
        }}
        onClick={() => {
          setOpen((v) => !v)
        }}
      >
        <ChevronDownIcon className="size-4" />
      </button>

      <div
        className={cn(
          'absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg',
          !expanded && 'hidden',
        )}
      >
        <ul
          id={listId}
          role="listbox"
          aria-label="Employees"
          className="max-h-72 overflow-y-auto p-1"
        >
          {items.map((person, index) => (
            // Keyboard users choose with the arrow keys and Enter in the field (the combobox
            // pattern), so the option itself needs no key handler.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={person.employee_id}
              id={optionId(index)}
              role="option"
              aria-selected={index === active}
              className={cn(
                'flex cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 text-sm',
                index === active ? 'bg-primary-soft text-foreground' : 'hover:bg-muted',
              )}
              onMouseDown={(event) => {
                event.preventDefault()
              }}
              onMouseEnter={() => {
                setActive(index)
              }}
              onClick={() => {
                pick(person)
              }}
            >
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{person.name ?? person.employee_id}</span>
                {person.role !== 'employee' ? (
                  <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-px text-xs font-semibold text-primary-soft-foreground">
                    {ROLE_LABELS[person.role]}
                  </span>
                ) : null}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {[
                  person.employee_id,
                  person.department,
                  person.surveys
                    ? `in ${String(person.surveys)} ${person.surveys === 1 ? 'survey' : 'surveys'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
          {people.isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2Icon className="size-3 animate-spin" aria-hidden="true" />
              Loading employees…
            </span>
          ) : people.isError ? (
            "Couldn't load employees. You can still type an ID."
          ) : items.length === 0 ? (
            'No one matches. You can still sign in with any ID.'
          ) : total > items.length ? (
            `Showing ${String(items.length)} of ${String(total)}. Type a name or ID to narrow it down.`
          ) : (
            `${String(total)} ${total === 1 ? 'person' : 'people'}`
          )}
        </p>
      </div>
    </div>
  )
}
