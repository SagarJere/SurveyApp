import { ShieldCheckIcon } from 'lucide-react'

export const SMALL_GROUP_MESSAGE =
  'Fewer than 5 people in this group have responded, so their answers are hidden to protect anonymity.'

export function SmallGroupNotice() {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border bg-muted/60 p-4 text-sm text-foreground"
    >
      <ShieldCheckIcon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
      <p>{SMALL_GROUP_MESSAGE}</p>
    </div>
  )
}
