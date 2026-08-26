'use client'

import type { ChecklistErrorPayload, ProgressEntry, SessionView } from './types'
import Cookies from 'js-cookie'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { isSessionView, parseSSEFrame } from './types'

// What seeds a new Fix session: either a failed workflow run (existing
// run-fix flow) or a set of client-detected pre-publish checklist errors
// (checklist-fix flow). Exactly one of the two is sent to the backend.
type CreateSessionTarget = { failedRunId: string } | { checklistErrors: ChecklistErrorPayload[] }

export type UseDifyBuilderSessionParams = {
  baseUrl: string
}

export type UseDifyBuilderSessionResult = {
  view: SessionView | null
  lastRaw: unknown
  lastError: string
  progressLog: ProgressEntry[]
  /** Creates a new Fix session for `failedRunId` and starts streaming its progress. */
  startFix: (appId: string, failedRunId: string) => Promise<boolean>
  /** Creates a new checklist-fix session for `checklistErrors` and starts streaming its progress. */
  startChecklistFix: (appId: string, checklistErrors: ChecklistErrorPayload[]) => Promise<boolean>
  /** Re-fetches the current session (GET). No-op if no session has been created yet. */
  refresh: () => Promise<boolean>
  /** Posts an action (`approve_repair`, `run_verify`, ...) against the current session. */
  runAction: (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>
  /** Posts a free-text message against the current session. */
  sendMessage: (text: string) => Promise<boolean>
}

function useDifyBuilderApi(baseUrl: string) {
  // Memoized so the returned methods stay referentially stable across renders
  // unless the connection inputs actually change (also what earns the `use` prefix).
  return useMemo(() => {
    // OSS-native difyBuilder routes (post-pivot): `/console/api/dify-builder/*`
    // (the retired enterprise Go backend lived at `.../enterprise/dify-builder/*`).
    const root = `${baseUrl.replace(/\/$/, '')}/dify-builder`

    const headers = (json: boolean, csrf: boolean): Record<string, string> => {
      const h: Record<string, string> = {}
      if (json) h['Content-Type'] = 'application/json'
      if (csrf) h[CSRF_HEADER_NAME] = Cookies.get(CSRF_COOKIE_NAME()) || ''
      return h
    }

    const create = (appId: string, target: CreateSessionTarget) =>
      fetch(`${root}/sessions`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true, true),
        body: JSON.stringify({
          app_id: appId,
          ...('failedRunId' in target
            ? { failed_run_id: target.failedRunId }
            : { checklist_errors: target.checklistErrors }),
        }),
      })

    // NOTE: the OSS backend enforces CSRF on every method (login_required), so
    // GET /sessions/{id} and the SSE stream must send X-CSRF-Token too — unlike
    // the old Go backend, which skipped CSRF on GETs.
    const get = (id: string) =>
      fetch(`${root}/sessions/${id}`, {
        credentials: 'include',
        headers: headers(false, true),
      })

    const action = (
      id: string,
      actionId: string,
      baseVersion: number,
      payload: Record<string, unknown> = {},
    ) =>
      fetch(`${root}/sessions/${id}/actions`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true, true),
        // Data-driven action id (Slice 0 Task 5a/7): the backend accepts
        // `action_id` (and, for back-compat, legacy `kind`); the FE now only
        // ever sends the id it got from `view.actions[].id`.
        body: JSON.stringify({ action_id: actionId, payload, base_version: baseVersion }),
      })

    const message = (id: string, text: string, baseVersion: number) =>
      fetch(`${root}/sessions/${id}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true, true),
        body: JSON.stringify({ text, base_version: baseVersion }),
      })

    const streamURL = (id: string) => `${root}/sessions/${id}/stream`
    // Headers for the SSE GET: X-CSRF-Token, no Content-Type.
    const streamHeaders = () => headers(false, true)

    return { create, get, action, message, streamURL, streamHeaders }
  }, [baseUrl])
}

/**
 * Owns the dify-builder Fix session lifecycle: creating a session, streaming
 * its SSE progress log, posting actions/messages, and refreshing session state.
 * Shared by the standalone `/dify-builder-debug` page and the in-editor
 * Dify Builder panel so both drive the exact same request/stream logic.
 */
export function useDifyBuilderSession({
  baseUrl,
}: UseDifyBuilderSessionParams): UseDifyBuilderSessionResult {
  const [view, setView] = useState<SessionView | null>(null)
  const [lastRaw, setLastRaw] = useState<unknown>(null)
  const [lastError, setLastError] = useState('')
  const [progressLog, setProgressLog] = useState<ProgressEntry[]>([])

  const abortRef = useRef<AbortController | null>(null)
  const progressIdRef = useRef(0)

  const api = useDifyBuilderApi(baseUrl)

  // Cancel the in-flight stream when the owning component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const pushProgress = useCallback((event: string, data: unknown) => {
    progressIdRef.current += 1
    setProgressLog((prev) => [...prev, { id: progressIdRef.current, event, data }])
  }, [])

  // Keep `view` in sync with the live session via the SSE stream. The `snapshot`
  // frame carries a full SessionView; `state` frames carry an incremental
  // { version, phase, run_status, state, canvas_read_only, actions }. Without
  // this the held `view.version` stays frozen at the create-time value, so
  // the next action's base_version CAS 409s the moment the engine has
  // auto-advanced (diagnose→propose→apply→await_verify), and the rendered
  // action buttons (data-driven off `view.actions`) go stale.
  const reconcileView = useCallback((data: unknown) => {
    if (!data || typeof data !== 'object') return
    const d = data as Partial<SessionView>
    if (typeof d.version !== 'number') return // only versioned frames (snapshot / state)
    const full = isSessionView(data)
    setView((prev) => {
      if (prev && d.version! < prev.version) return prev // never regress the version
      if (full) return data as SessionView
      if (!prev) return prev // incremental frame with no base view: nothing to merge
      const next: SessionView = { ...prev, version: d.version! }
      if (typeof d.state === 'string') next.state = d.state
      if (typeof d.canvas_read_only === 'boolean') next.canvas_read_only = d.canvas_read_only
      if (typeof d.run_status === 'string') next.run_status = d.run_status
      if (typeof d.phase === 'string') next.phase = d.phase
      if (Array.isArray(d.actions)) next.actions = d.actions
      return next
    })
  }, [])

  const applyResponse = useCallback(async (res: Response): Promise<unknown> => {
    const text = await res.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // leave as raw text; still shown in the "Last Raw Response" panel
    }
    setLastRaw(parsed)
    setLastError(res.ok ? '' : `HTTP ${res.status}`)
    if (isSessionView(parsed)) setView(parsed)
    return parsed
  }, [])

  const startStream = useCallback(
    (sessionId: string) => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      fetch(api.streamURL(sessionId), {
        credentials: 'include',
        signal: controller.signal,
        headers: api.streamHeaders(),
      })
        .then(async (res) => {
          const reader = res.body?.getReader()
          if (!reader) return
          const decoder = new TextDecoder()
          let buffer = ''
          let done = false
          while (!done) {
            const result = await reader.read()
            done = result.done
            if (result.value) buffer += decoder.decode(result.value, { stream: true })
            const frames = buffer.split('\n\n')
            buffer = frames.pop() ?? ''
            frames.forEach((frame) => {
              const parsed = parseSSEFrame(frame)
              if (!parsed) return
              pushProgress(parsed.event, parsed.data)
              reconcileView(parsed.data)
            })
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          pushProgress('error', String(err))
        })
    },
    [api, pushProgress, reconcileView],
  )

  const beginSession = useCallback(
    async (appId: string, target: CreateSessionTarget) => {
      try {
        const res = await api.create(appId, target)
        const parsed = await applyResponse(res)
        if (isSessionView(parsed)) startStream(parsed.session_id)
        return true
      } catch (err) {
        setLastError(String(err))
        return false
      }
    },
    [api, applyResponse, startStream],
  )

  const startFix = useCallback(
    (appId: string, failedRunId: string) => beginSession(appId, { failedRunId }),
    [beginSession],
  )

  const startChecklistFix = useCallback(
    (appId: string, checklistErrors: ChecklistErrorPayload[]) =>
      beginSession(appId, { checklistErrors }),
    [beginSession],
  )

  const refresh = useCallback(async () => {
    if (!view) return false
    try {
      const res = await api.get(view.session_id)
      await applyResponse(res)
      return true
    } catch (err) {
      setLastError(String(err))
      return false
    }
  }, [api, applyResponse, view])

  const runAction = useCallback(
    async (actionId: string, payload: Record<string, unknown> = {}) => {
      if (!view) return false
      try {
        const res = await api.action(view.session_id, actionId, view.version, payload)
        await applyResponse(res)
        return true
      } catch (err) {
        setLastError(String(err))
        return false
      }
    },
    [api, applyResponse, view],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      if (!view) return false
      try {
        const res = await api.message(view.session_id, text, view.version)
        await applyResponse(res)
        return true
      } catch (err) {
        setLastError(String(err))
        return false
      }
    },
    [api, applyResponse, view],
  )

  return {
    view,
    lastRaw,
    lastError,
    progressLog,
    startFix,
    startChecklistFix,
    refresh,
    runAction,
    sendMessage,
  }
}
