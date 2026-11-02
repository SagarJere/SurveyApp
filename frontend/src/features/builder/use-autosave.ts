import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { saveDraft } from '@/features/surveys/api'
import { ApiError } from '@/lib/api'

import { useBuilderStore } from './store'

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict'

export const AUTOSAVE_DELAY_MS = 800
export const RETRY_DELAY_MS = 5000

type SaveOutcome = 'saved' | 'conflict' | 'failed'

export interface Autosave {
  status: SaveStatus
  /** Save now. Resolves true when everything up to this moment is saved. */
  flush: () => Promise<boolean>
}

/**
 * Save the builder draft 800 ms after the last change (docs/05-survey-builder.md, Autosave).
 * One save at a time; edits made during a save trigger another. On 409 it stops and reports
 * "conflict" so the page can offer a reload. Other failures retry every 5 s.
 */
export function useAutosave(surveyId: string, initialUpdatedAt: string): Autosave {
  const [status, setStatus] = useState<SaveStatus>('saved')
  const updatedAt = useRef(initialUpdatedAt)
  // load() resets the store's revision to 0, so 0 is "saved" for a freshly loaded draft.
  const savedRevision = useRef(0)
  const inFlight = useRef<Promise<SaveOutcome> | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const stopped = useRef(false)
  // Timers call the latest flush through this ref (flush schedules itself for retries).
  const flushRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))

  const schedule = useCallback((delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flushRef.current(), delay)
  }, [])

  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current)
    // One save at a time. Re-check after each wait: another caller may have started one.
    while (inFlight.current) await inFlight.current
    if (stopped.current) return false

    const { draft, revision, surveyId: loaded } = useBuilderStore.getState()
    if (loaded !== surveyId) return false
    if (revision === savedRevision.current) {
      setStatus('saved')
      return true
    }

    setStatus('saving')
    const run = (async (): Promise<SaveOutcome> => {
      try {
        const result = await saveDraft(surveyId, draft, updatedAt.current)
        updatedAt.current = result.draft_updated_at
        savedRevision.current = revision
        return 'saved'
      } catch (error) {
        return error instanceof ApiError && error.status === 409 ? 'conflict' : 'failed'
      }
    })()
    inFlight.current = run
    const outcome = await run
    inFlight.current = null

    if (outcome === 'conflict') {
      stopped.current = true
      setStatus('conflict')
      return false
    }
    if (outcome === 'failed') {
      setStatus('error')
      schedule(RETRY_DELAY_MS)
      return false
    }
    if (useBuilderStore.getState().revision !== savedRevision.current) {
      setStatus('pending')
      schedule(AUTOSAVE_DELAY_MS)
      return false
    }
    setStatus('saved')
    return true
  }, [schedule, surveyId])

  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  // Debounce: every draft change restarts the 800 ms timer.
  useEffect(
    () =>
      useBuilderStore.subscribe((state, previous) => {
        if (state.revision === previous.revision || stopped.current) return
        if (state.revision === savedRevision.current) return
        setStatus((current) => (current === 'saving' ? current : 'pending'))
        schedule(AUTOSAVE_DELAY_MS)
      }),
    [schedule],
  )

  // Save when the tab is hidden; warn before closing with unsaved changes.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (stopped.current) return
      if (useBuilderStore.getState().revision !== savedRevision.current || inFlight.current) {
        event.preventDefault()
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flush])

  // Leaving the builder inside the app: save what's pending. A layout-effect cleanup runs
  // before the next page can load a different survey into the store.
  useLayoutEffect(
    () => () => {
      void flush()
    },
    [flush],
  )

  return { status, flush }
}
