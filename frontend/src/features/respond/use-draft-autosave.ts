import { useCallback, useEffect, useRef, useState } from 'react'

import type { Answers } from '@/features/survey-logic/types'
import { env } from '@/lib/env'
import { tokenStore } from '@/lib/token-store'

import { saveRespondentDraft } from './api'

export const DRAFT_DELAY_MS = 1500
const RETRY_MS = 5000

export type DraftState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Save answers about 1.5 s after the last change, and when the page is hidden or closed
 * (docs/06-respondent-experience.md, Saving and submitting). Saves run one after another, so
 * an older save can never land after a newer one.
 */
export function useDraftAutosave(surveyId: string, enabled: boolean) {
  const [state, setState] = useState<DraftState>('idle')
  const pending = useRef<Answers | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const active = useRef(enabled)
  // Timers call the latest save through this ref (save schedules itself for retries).
  const saveRef = useRef<() => void>(() => undefined)
  const hasPending = () => pending.current !== null

  useEffect(() => {
    active.current = enabled
  }, [enabled])

  const save = useCallback(() => {
    window.clearTimeout(timer.current)
    chain.current = chain.current.then(async () => {
      const answers = pending.current
      if (!answers || !active.current) return
      pending.current = null
      setState('saving')
      try {
        await saveRespondentDraft(surveyId, answers)
        setState(hasPending() ? 'saving' : 'saved')
      } catch {
        pending.current ??= answers // keep it for the retry unless newer answers arrived
        setState('error')
        timer.current = window.setTimeout(() => {
          saveRef.current()
        }, RETRY_MS)
      }
    })
  }, [surveyId])

  useEffect(() => {
    saveRef.current = save
  }, [save])

  const queue = useCallback((answers: Answers) => {
    if (!active.current) return
    pending.current = answers
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      saveRef.current()
    }, DRAFT_DELAY_MS)
  }, [])

  /** Drop anything unsaved (used just before submitting, which saves everything anyway). */
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current)
    pending.current = null
  }, [])

  useEffect(() => {
    // The page may be gone before an async save finishes, so leave with a keepalive request.
    const sendNow = () => {
      const answers = pending.current
      if (!answers || !active.current) return
      pending.current = null
      window.clearTimeout(timer.current)
      const token = tokenStore.get()
      const url = new URL(`${env.apiBaseUrl}/respond/${surveyId}/draft`, window.location.origin)
      void fetch(url, {
        method: 'PUT',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ answers }),
      }).catch(() => undefined)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') sendNow()
    }
    window.addEventListener('pagehide', sendNow)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', sendNow)
      document.removeEventListener('visibilitychange', onVisibility)
      sendNow() // leaving the page inside the app
      window.clearTimeout(timer.current)
    }
  }, [surveyId])

  return { state, queue, cancel }
}
