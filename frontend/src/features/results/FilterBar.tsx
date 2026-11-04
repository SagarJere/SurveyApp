import { XIcon } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'

import type { ResultFilters } from './api'

const ANY = '__any__'
const NONE = '__none__'

/** "" in the URL means "not recorded" (people uploaded without a department or location). */
function toSelect(value: string | null): string {
  if (value === null) return ANY
  return value === '' ? NONE : value
}

function fromSelect(value: string): string | null {
  if (value === ANY) return null
  return value === NONE ? '' : value
}

interface FilterBarProps {
  filters: ResultFilters
  options: { departments: string[]; locations: string[] }
  active: boolean
  onChange: (patch: Partial<ResultFilters>) => void
  onClear: () => void
}

export function FilterBar({ filters, options, active, onChange, onClear }: FilterBarProps) {
  const id = useId()
  const dateError = filters.from && filters.to && filters.from > filters.to
  return (
    <section aria-label="Filters" className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end">
        <Choice
          id={`${id}-dept`}
          label="Department"
          allLabel="All departments"
          values={options.departments}
          value={filters.department}
          onChange={(department) => {
            onChange({ department })
          }}
        />
        <Choice
          id={`${id}-loc`}
          label="Location"
          allLabel="All locations"
          values={options.locations}
          value={filters.location}
          onChange={(location) => {
            onChange({ location })
          }}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-from`}>From</Label>
          <Input
            id={`${id}-from`}
            type="date"
            value={filters.from ?? ''}
            max={filters.to ?? undefined}
            onChange={(event) => {
              onChange({ from: event.target.value || null })
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={`${id}-to`}>To</Label>
          <Input
            id={`${id}-to`}
            type="date"
            value={filters.to ?? ''}
            min={filters.from ?? undefined}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? `${id}-date-error` : undefined}
            onChange={(event) => {
              onChange({ to: event.target.value || null })
            }}
          />
        </div>
        {active ? (
          <Button variant="ghost" className="col-span-2 justify-self-start" onClick={onClear}>
            <XIcon aria-hidden="true" />
            Clear filters
          </Button>
        ) : null}
      </div>
      {dateError ? (
        <p id={`${id}-date-error`} className="text-sm text-destructive">
          The “From” date is after the “To” date, so nothing matches.
        </p>
      ) : null}
    </section>
  )
}

function Choice({
  id,
  label,
  allLabel,
  values,
  value,
  onChange,
}: {
  id: string
  label: string
  allLabel: string
  values: string[]
  value: string | null
  onChange: (value: string | null) => void
}) {
  const selected = toSelect(value)
  // Keep a value from a shared link visible even if it no longer has anyone in it.
  const known = selected === ANY || selected === NONE || values.includes(selected)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={selected}
        className="sm:w-48"
        onChange={(event) => {
          onChange(fromSelect(event.target.value))
        }}
      >
        <option value={ANY}>{allLabel}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {known ? null : <option value={selected}>{selected}</option>}
        <option value={NONE}>Not recorded</option>
      </NativeSelect>
    </div>
  )
}
