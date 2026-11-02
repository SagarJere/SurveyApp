import { Loader2Icon } from 'lucide-react'

export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <Loader2Icon className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )
}
