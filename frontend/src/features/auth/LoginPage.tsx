import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { InfoIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'

import { AppMark } from '@/components/app-mark'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ThemeToggle } from '@/app/theme/ThemeToggle'
import { usePageTitle } from '@/hooks/use-page-title'
import { ApiError } from '@/lib/api'
import { env } from '@/lib/env'

import { login } from './api'
import { employeeIdProblem, normalizeEmployeeId } from './employee-id'
import { safeNextPath } from './redirect'
import { useAuth } from './use-auth'

const schema = z.object({
  employeeId: z.string().superRefine((value, ctx) => {
    const problem = employeeIdProblem(value)
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  }),
})

type FormValues = z.infer<typeof schema>

function fieldMessage(error: ApiError, field: string): string | null {
  const issues = error.details.issues
  if (!Array.isArray(issues)) return null
  for (const issue of issues as unknown[]) {
    if (
      typeof issue === 'object' &&
      issue !== null &&
      (issue as { field?: unknown }).field === field &&
      typeof (issue as { message?: unknown }).message === 'string'
    ) {
      return (issue as { message: string }).message
    }
  }
  return null
}

export function LoginPage() {
  usePageTitle('Sign in')
  const { status, signOutReason, completeSignIn } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNextPath(params.get('next'))
  const expired = params.get('reason') === 'expired' || signOutReason === 'expired'
  const ids = { field: useId(), hint: useId(), error: useId(), formError: useId() }

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { employeeId: '' },
  })

  const mutation = useMutation({
    mutationFn: (employeeId: string) => login(employeeId),
    onSuccess: (response) => {
      completeSignIn(response)
      void navigate(next, { replace: true })
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const message = fieldMessage(error, 'employee_id')
        if (message) {
          form.setError('employeeId', { message }, { shouldFocus: true })
          return
        }
      }
      form.setError('root', {
        message:
          error instanceof ApiError ? error.message : "We couldn't sign you in. Please try again.",
      })
    },
  })

  if (status === 'signed-in') return <Navigate to={next} replace />

  const fieldError = form.formState.errors.employeeId?.message
  const rootError = form.formState.errors.root?.message
  const pending = mutation.isPending

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <AppMark to="/login" />
        <ThemeToggle />
      </header>
      <main
        id="main-content"
        className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-0"
      >
        <div className="w-full max-w-sm rounded-2xl border border-t-[6px] border-t-primary bg-card p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold">Sign in to {env.appName}</h1>

          {expired ? (
            <p
              className="mt-4 flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn"
              role="status"
            >
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Your session has expired. Please sign in again.
            </p>
          ) : null}

          {env.authMode === 'dev' ? (
            <form
              className="mt-6 flex flex-col gap-4"
              noValidate
              aria-describedby={rootError ? ids.formError : undefined}
              onSubmit={(event) => {
                void form.handleSubmit((values) => {
                  mutation.mutate(normalizeEmployeeId(values.employeeId))
                })(event)
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor={ids.field}>Employee ID</Label>
                <Input
                  id={ids.field}
                  autoComplete="username"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="go"
                  placeholder="e.g. E12345"
                  aria-invalid={fieldError ? true : undefined}
                  aria-describedby={fieldError ? `${ids.error} ${ids.hint}` : ids.hint}
                  disabled={pending}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- the only field on the page
                  autoFocus
                  {...form.register('employeeId')}
                />
                {fieldError ? (
                  <p id={ids.error} className="text-sm font-semibold text-destructive" role="alert">
                    {fieldError}
                  </p>
                ) : null}
                <p id={ids.hint} className="text-sm text-muted-foreground">
                  This test environment signs you in with your employee ID only.
                </p>
              </div>

              {rootError ? (
                <p
                  id={ids.formError}
                  className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm font-semibold text-warn"
                  role="alert"
                >
                  <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {rootError}
                </p>
              ) : null}

              <Button type="submit" size="lg" disabled={pending}>
                {pending ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : null}
                {pending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground" role="status">
              Single sign-on isn&apos;t set up for this environment yet. Contact your IT team.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
