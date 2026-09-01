'use client'

import type { SessionModel, SessionView } from '@dify/contracts/dify-builder'
import type { ChecklistErrorPayload, ProgressEntry } from './types'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import Cookies from 'js-cookie'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import {
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionLastRawAtom,
  difyBuilderSessionProgressLogAtom,
  difyBuilderSessionViewAtom,
} from './state'
import { isSessionView, parseSSEFrame } from './types'

// What seeds a new Fix session: either a failed workflow run (existing
// run-fix flow) or a set of client-detected pre-publish checklist errors
// (checklist-fix flow). Exactly one of the two is sent to the backend.
type CreateSessionRequest =
  | { scenario: 'build'; goalText: string; modelConfig?: SessionModel }
  | { scenario: 'edit'; modelConfig?: SessionModel }
  | {
      scenario: 'fix'
      target: { failedRunId: string } | { checklistErrors: ChecklistErrorPayload[] }
      modelConfig?: SessionModel
    }

export type UseDifyBuilderSessionParams = {
  baseUrl: string
}

export type UseDifyBuilderSessionResult = {
  view: SessionView | null
  isBusy: boolean
  lastRaw: unknown
  lastError: string
  progressLog: ProgressEntry[]
  /** Creates a new Fix session for `failedRunId` and starts streaming its progress. */
  startFix: (appId: string, failedRunId: string, modelConfig?: SessionModel) => Promise<boolean>
  /** Creates a new checklist-fix session for `checklistErrors` and starts streaming its progress. */
  startChecklistFix: (
    appId: string,
    checklistErrors: ChecklistErrorPayload[],
    modelConfig?: SessionModel,
  ) => Promise<boolean>
  /** Creates a new Build session and dispatches the opening goal. */
  startBuild: (appId: string, goalText: string, modelConfig?: SessionModel) => Promise<boolean>
  /** Creates an Edit session and dispatches the opening edit goal. */
  startEdit: (appId: string, goalText: string, modelConfig?: SessionModel) => Promise<boolean>
  /** Re-fetches the current session (GET). No-op if no session has been created yet. */
  refresh: () => Promise<boolean>
  /** Posts an action (`approve_repair`, `run_verify`, ...) against the current session. */
  runAction: (actionId: string, payload?: Record<string, unknown>) => Promise<boolean>
  /** Posts a free-text message against the current session. */
  sendMessage: (text: string) => Promise<boolean>
  /** Persists a model selection on an idle/waiting session. */
  updateModel: (modelConfig: SessionModel) => Promise<boolean>
  /** Clears the local session without deleting server-side history. */
  reset: () => void
}

export type DifyBuilderSessionController = Omit<
  UseDifyBuilderSessionResult,
  'view' | 'isBusy' | 'lastRaw' | 'lastError' | 'progressLog'
>

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

    const create = (appId: string, request: CreateSessionRequest) =>
      fetch(`${root}/sessions`, {
        method: 'POST',
        credentials: 'include',
        headers: headers(true, true),
        body: JSON.stringify({
          app_id: appId,
          scenario: request.scenario,
          ...('modelConfig' in request && request.modelConfig
            ? { model_config: request.modelConfig }
            : {}),
          ...(request.scenario === 'build' ? { goal_text: request.goalText } : {}),
          ...(request.scenario !== 'fix'
            ? {}
            : 'failedRunId' in request.target
              ? { failed_run_id: request.target.failedRunId }
              : { checklist_errors: request.target.checklistErrors }),
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
 * Owns the Dify Builder session lifecycle: creating a session, streaming
 * its SSE progress log, posting actions/messages, and refreshing session state.
 * Shared by the standalone `/dify-builder-debug` page and the in-editor
 * Dify Builder panel so both drive the exact same request/stream logic.
 */
export function useDifyBuilderSessionController({
  baseUrl,
}: UseDifyBuilderSessionParams): DifyBuilderSessionController {
  const store = useStore()
  const setView = useSetAtom(difyBuilderSessionViewAtom)
  const setLastRaw = useSetAtom(difyBuilderSessionLastRawAtom)
  const setLastError = useSetAtom(difyBuilderSessionLastErrorAtom)
  const setProgressLog = useSetAtom(difyBuilderSessionProgressLogAtom)
  const setIsBusy = useSetAtom(difyBuilderSessionBusyAtom)
  const abortRef = useRef<AbortController | null>(null)
  const pendingAdvanceVersionRef = useRef<number | null>(null)
  const progressIdRef = useRef(0)

  const api = useDifyBuilderApi(baseUrl)

  // Cancel the in-flight stream when the owning component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const pushProgress = useCallback(
    (event: string, data: unknown) => {
      progressIdRef.current += 1
      setProgressLog((prev) => [...prev, { id: progressIdRef.current, event, data }])
    },
    [setProgressLog],
  )

  const finishPendingAdvance = useCallback(
    (version?: number) => {
      const pendingVersion = pendingAdvanceVersionRef.current
      if (pendingVersion === null) return
      if (version !== undefined && version <= pendingVersion) return
      pendingAdvanceVersionRef.current = null
      setIsBusy(false)
    },
    [setIsBusy],
  )

  // Keep `view` in sync with the live session via the SSE stream. The `snapshot`
  // frame carries a full SessionView; `state` frames carry an incremental
  // { version, phase, run_status, state, canvas_read_only, actions }. Without
  // this the held `view.version` stays frozen at the create-time value, so
  // the next action's base_version CAS 409s the moment the engine has
  // auto-advanced (diagnose→propose→apply→await_verify), and the rendered
  // action buttons (data-driven off `view.actions`) go stale.
  const reconcileView = useCallback(
    (data: unknown) => {
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
    },
    [setView],
  )

  const applyResponse = useCallback(
    async (res: Response): Promise<unknown> => {
      const text = await res.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // leave as raw text; still shown in the "Last Raw Response" panel
      }
      setLastRaw(parsed)
      setLastError(res.ok ? '' : `HTTP ${res.status}`)
      if (isSessionView(parsed)) {
        setView((current) => {
          if (current && parsed.version < current.version) return current
          return parsed
        })
      }
      return parsed
    },
    [setLastError, setLastRaw, setView],
  )

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
          if (!res.ok) {
            setLastError(`HTTP ${res.status}`)
            finishPendingAdvance()
            return
          }
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
            for (const frame of frames) {
              const parsed = parseSSEFrame(frame)
              if (!parsed) continue
              pushProgress(parsed.event, parsed.data)
              reconcileView(parsed.data)
              if (isSessionView(parsed.data)) finishPendingAdvance(parsed.data.version)
              else if (
                parsed.data &&
                typeof parsed.data === 'object' &&
                typeof (parsed.data as Partial<SessionView>).version === 'number'
              ) {
                finishPendingAdvance((parsed.data as Partial<SessionView>).version)
              }
              if (parsed.event === 'error') finishPendingAdvance()
              if (parsed.event === 'state') {
                const latest = await api.get(sessionId)
                await applyResponse(latest)
              }
            }
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setLastError(String(err))
          finishPendingAdvance()
          pushProgress('error', String(err))
        })
    },
    [api, applyResponse, finishPendingAdvance, pushProgress, reconcileView, setLastError],
  )

  const beginSession = useCallback(
    async (appId: string, request: CreateSessionRequest) => {
      setIsBusy(true)
      setLastError('')
      setProgressLog([])
      abortRef.current?.abort()
      try {
        const res = await api.create(appId, request)
        const parsed = await applyResponse(res)
        if (!res.ok || !isSessionView(parsed)) return false
        startStream(parsed.session_id)
        return true
      } catch (err) {
        setLastError(String(err))
        return false
      } finally {
        setIsBusy(false)
      }
    },
    [api, applyResponse, setIsBusy, setLastError, setProgressLog, startStream],
  )

  const startFix = useCallback(
    (appId: string, failedRunId: string, modelConfig?: SessionModel) =>
      beginSession(appId, {
        scenario: 'fix',
        target: { failedRunId },
        modelConfig,
      }),
    [beginSession],
  )

  const startChecklistFix = useCallback(
    (appId: string, checklistErrors: ChecklistErrorPayload[], modelConfig?: SessionModel) =>
      beginSession(appId, {
        scenario: 'fix',
        target: { checklistErrors },
        modelConfig,
      }),
    [beginSession],
  )

  const startBuild = useCallback(
    (appId: string, goalText: string, modelConfig?: SessionModel) =>
      beginSession(appId, { scenario: 'build', goalText, modelConfig }),
    [beginSession],
  )

  const startEdit = useCallback(
    async (appId: string, goalText: string, modelConfig?: SessionModel) => {
      setIsBusy(true)
      setLastError('')
      setProgressLog([])
      abortRef.current?.abort()
      try {
        const createResponse = await api.create(appId, { scenario: 'edit', modelConfig })
        const created = await applyResponse(createResponse)
        if (!createResponse.ok || !isSessionView(created)) return false

        const actionResponse = await api.action(
          created.session_id,
          'send_edit_goal',
          created.version,
          { text: goalText },
        )
        const updated = await applyResponse(actionResponse)
        if (!actionResponse.ok || !isSessionView(updated)) return false
        startStream(updated.session_id)
        return true
      } catch (err) {
        setLastError(String(err))
        return false
      } finally {
        setIsBusy(false)
      }
    },
    [api, applyResponse, setIsBusy, setLastError, setProgressLog, startStream],
  )

  const refresh = useCallback(async () => {
    const view = store.get(difyBuilderSessionViewAtom)
    if (!view) return false
    setIsBusy(true)
    try {
      const res = await api.get(view.session_id)
      await applyResponse(res)
      return res.ok
    } catch (err) {
      setLastError(String(err))
      return false
    } finally {
      setIsBusy(false)
    }
  }, [api, applyResponse, setIsBusy, setLastError, store])

  const runAction = useCallback(
    async (actionId: string, payload: Record<string, unknown> = {}) => {
      const view = store.get(difyBuilderSessionViewAtom)
      const isBusy = store.get(difyBuilderSessionBusyAtom)
      if (!view || isBusy) return false
      const baseVersion = view.version
      let waitsForAdvance = false
      setIsBusy(true)
      try {
        const res = await api.action(view.session_id, actionId, view.version, payload)
        const parsed = await applyResponse(res)
        if (res.ok && isSessionView(parsed)) {
          waitsForAdvance = parsed.version <= baseVersion && actionId !== 'update_model'
          pendingAdvanceVersionRef.current = waitsForAdvance ? baseVersion : null
          startStream(parsed.session_id)
        }
        return res.ok
      } catch (err) {
        setLastError(String(err))
        return false
      } finally {
        if (!waitsForAdvance) setIsBusy(false)
      }
    },
    [api, applyResponse, setIsBusy, setLastError, startStream, store],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const view = store.get(difyBuilderSessionViewAtom)
      const isBusy = store.get(difyBuilderSessionBusyAtom)
      if (!view || isBusy) return false
      const baseVersion = view.version
      let waitsForAdvance = false
      setIsBusy(true)
      try {
        const res = await api.message(view.session_id, text, view.version)
        const parsed = await applyResponse(res)
        if (res.ok && isSessionView(parsed)) {
          waitsForAdvance = parsed.version <= baseVersion
          pendingAdvanceVersionRef.current = waitsForAdvance ? baseVersion : null
          startStream(parsed.session_id)
        }
        return res.ok
      } catch (err) {
        setLastError(String(err))
        return false
      } finally {
        if (!waitsForAdvance) setIsBusy(false)
      }
    },
    [api, applyResponse, setIsBusy, setLastError, startStream, store],
  )

  const updateModel = useCallback(
    (modelConfig: SessionModel) => runAction('update_model', { model_config: modelConfig }),
    [runAction],
  )

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    pendingAdvanceVersionRef.current = null
    setView(null)
    setLastRaw(null)
    setLastError('')
    setProgressLog([])
    setIsBusy(false)
  }, [setIsBusy, setLastError, setLastRaw, setProgressLog, setView])

  return useMemo(
    () => ({
      startFix,
      startChecklistFix,
      startBuild,
      startEdit,
      refresh,
      runAction,
      sendMessage,
      updateModel,
      reset,
    }),
    [
      refresh,
      reset,
      runAction,
      sendMessage,
      startBuild,
      startChecklistFix,
      startEdit,
      startFix,
      updateModel,
    ],
  )
}

export function useDifyBuilderSession({
  baseUrl,
}: UseDifyBuilderSessionParams): UseDifyBuilderSessionResult {
  const controller = useDifyBuilderSessionController({ baseUrl })
  const view = useAtomValue(difyBuilderSessionViewAtom)
  const isBusy = useAtomValue(difyBuilderSessionBusyAtom)
  const lastRaw = useAtomValue(difyBuilderSessionLastRawAtom)
  const lastError = useAtomValue(difyBuilderSessionLastErrorAtom)
  const progressLog = useAtomValue(difyBuilderSessionProgressLogAtom)

  return useMemo(
    () => ({
      view,
      isBusy,
      lastRaw,
      lastError,
      progressLog,
      ...controller,
    }),
    [controller, isBusy, lastError, lastRaw, progressLog, view],
  )
}
