'use client'

import type { DifyBuilderModelConfigPayload } from '@dify/contracts/api/console/dify-builder/types.gen'
import type { ReactNode } from 'react'
import type {
  DifyBuilderContextValue,
  DifyBuilderFixTarget,
  DifyBuilderSessionView,
} from './context'
import { zDifyBuilderSessionViewResponse } from '@dify/contracts/api/console/dify-builder/zod.gen'
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Cookies from 'js-cookie'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi as useReactFlowStoreApi } from 'reactflow'
import { parseSSEFrame } from '@/app/components/dify-builder/types'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore } from '@/app/components/workflow/store'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { consoleClient, consoleQuery } from '@/service/client'
import { DifyBuilderContext } from './context'
import { getDifyBuilderErrorMessage } from './error-message'
import { shouldStartBuildSession } from './utils'

const getSessionQueryKey = (sessionId: string) =>
  consoleQuery.difyBuilder.sessions.bySessionId.get.queryOptions({
    input: { params: { session_id: sessionId } },
  }).queryKey

const isTerminal = (view: DifyBuilderSessionView | null) =>
  view?.run_status === 'complete' || view?.run_status === 'failed'

export const DifyBuilderProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation()
  const appId = useStore((state) => state.appId)
  const setCanvasReadOnly = useStore((state) => state.setCanvasReadOnly)
  const doSyncWorkflowDraft = useHooksStore((state) => state.doSyncWorkflowDraft)
  const handleRefreshWorkflowDraft = useHooksStore((state) => state.handleRefreshWorkflowDraft)
  const reactFlowStore = useReactFlowStoreApi()
  const queryClient = useQueryClient()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<DifyBuilderModelConfigPayload | null>(null)
  const [requestError, setRequestError] = useState('')
  const [streamError, setStreamError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const refreshPromiseRef = useRef<Promise<void> | null>(null)
  const terminalRef = useRef(false)
  const activeSessionIdRef = useRef<string | null>(null)
  const lastCanvasRefreshVersionRef = useRef(0)

  const sessionQuery = useQuery(
    consoleQuery.difyBuilder.sessions.bySessionId.get.queryOptions({
      input: sessionId ? { params: { session_id: sessionId } } : skipToken,
      refetchInterval: (query) => {
        const current = query.state.data
        return current?.run_status === 'executing' ? 1000 : false
      },
    }),
  )
  const { data: sessionData, isFetching: isSessionFetching, refetch: refetchSession } = sessionQuery
  const view = sessionData ?? null
  const terminal = isTerminal(view)
  const error = requestError || (terminal ? '' : streamError)
  terminalRef.current = terminal

  const formatError = useCallback(
    (requestError: unknown) =>
      getDifyBuilderErrorMessage(requestError, {
        fallback: t(($) => $['api.actionFailed'], { ns: 'common' }),
        codeMessages: {
          bad_request: t(($) => $['difyBuilder.error.badRequest'], { ns: 'workflow' }),
          conflict: t(($) => $['difyBuilder.error.conflict'], { ns: 'workflow' }),
          feature_unavailable: t(($) => $['difyBuilder.error.featureUnavailable'], {
            ns: 'workflow',
          }),
          not_found: t(($) => $['difyBuilder.error.notFound'], { ns: 'workflow' }),
          session_busy: t(($) => $['difyBuilder.error.sessionBusy'], { ns: 'workflow' }),
        },
      }),
    [t],
  )

  const { isPending: isRefreshingCanvas, mutateAsync: refreshWorkflowDraft } = useMutation({
    mutationFn: async () => {
      try {
        await handleRefreshWorkflowDraft()
      } catch (refreshError) {
        setRequestError(await formatError(refreshError))
        throw refreshError
      }
    },
  })

  const refreshCanvas = useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current

    const promise = refreshWorkflowDraft()
      .catch(() => undefined)
      .finally(() => {
        refreshPromiseRef.current = null
      })
    refreshPromiseRef.current = promise
    return promise
  }, [refreshWorkflowDraft])

  useEffect(() => {
    if (!view || view.version <= lastCanvasRefreshVersionRef.current) return
    lastCanvasRefreshVersionRef.current = view.version
    if (!['modify', 'test', 'review', 'publish', 'complete'].includes(view.phase)) return
    void refreshCanvas()
  }, [refreshCanvas, view])

  useEffect(() => {
    const locked = !!view?.canvas_read_only || isSubmitting || isRefreshingCanvas
    setCanvasReadOnly(locked)
  }, [isRefreshingCanvas, isSubmitting, setCanvasReadOnly, view?.canvas_read_only])

  useEffect(() => {
    return () => setCanvasReadOnly(false)
  }, [setCanvasReadOnly])

  useEffect(() => {
    if (!sessionId || terminal) return

    const controller = new AbortController()
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let active = true

    const invalidateSession = () =>
      queryClient.invalidateQueries({ queryKey: getSessionQueryKey(sessionId) })

    const connect = async () => {
      try {
        const response = await fetch(`${API_PREFIX}/dify-builder/sessions/${sessionId}/stream`, {
          credentials: 'include',
          headers: {
            [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
          },
          signal: controller.signal,
        })
        if (!response.ok) throw response

        const reader = response.body?.getReader()
        if (!reader)
          throw new Error(
            t(($) => $['difyBuilder.error.streamUnavailable'], { ns: 'workflow' }),
          )

        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          if (!active) break
          const result = await reader.read()
          if (result.done) break
          buffer += decoder.decode(result.value, { stream: true })
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            const parsed = parseSSEFrame(frame)
            if (!parsed) continue
            setStreamError('')
            const snapshot = zDifyBuilderSessionViewResponse.safeParse(parsed.data)
            if (parsed.event === 'snapshot' && snapshot.success) {
              queryClient.setQueryData(getSessionQueryKey(sessionId), snapshot.data)
            } else {
              void invalidateSession()
            }
            if (parsed.event === 'canvas') void refreshCanvas()
          }
        }
        if (active && !terminalRef.current) reconnectTimer = setTimeout(connect, 1000)
      } catch (streamError) {
        if (controller.signal.aborted) return
        const message = await formatError(streamError)
        if (!active || controller.signal.aborted) return
        setStreamError(message)
        if (active && !terminalRef.current) reconnectTimer = setTimeout(connect, 1500)
      }
    }

    void connect()
    return () => {
      active = false
      controller.abort()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [formatError, queryClient, refreshCanvas, sessionId, t, terminal])

  const storeView = useCallback(
    (nextView: unknown) => {
      const parsedView = zDifyBuilderSessionViewResponse.parse(nextView)
      if (activeSessionIdRef.current !== parsedView.session_id) {
        activeSessionIdRef.current = parsedView.session_id
        lastCanvasRefreshVersionRef.current = 0
        setStreamError('')
      }
      setSessionId(parsedView.session_id)
      queryClient.setQueryData(getSessionQueryKey(parsedView.session_id), parsedView)
    },
    [queryClient],
  )

  const startPrompt = useCallback(
    async (text: string, fixTarget?: DifyBuilderFixTarget) => {
      const prompt = text.trim()
      if (!appId || !prompt || isSubmitting) return false

      setRequestError('')
      setIsSubmitting(true)
      try {
        await doSyncWorkflowDraft()
        const { edges, getNodes } = reactFlowStore.getState()
        const scenario = fixTarget
          ? 'fix'
          : shouldStartBuildSession(getNodes(), edges.length)
            ? 'build'
            : 'edit'
        const response = await consoleClient.difyBuilder.sessions.post({
          body: {
            app_id: appId,
            scenario,
            goal_text: prompt,
            model_config: selectedModel ?? undefined,
            ...(!fixTarget
              ? {}
              : 'failedRunId' in fixTarget
                ? { failed_run_id: fixTarget.failedRunId }
                : { checklist_errors: fixTarget.checklistErrors }),
          },
        })
        storeView(response)

        if (scenario === 'edit') {
          const editResponse = await consoleClient.difyBuilder.sessions.bySessionId.actions.post({
            params: { session_id: response.session_id },
            body: {
              action_id: 'send_edit_goal',
              base_version: response.version,
              payload: { text: prompt },
            },
          })
          storeView(editResponse)
        }
        return true
      } catch (requestError) {
        setRequestError(await formatError(requestError))
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [
      appId,
      doSyncWorkflowDraft,
      formatError,
      isSubmitting,
      reactFlowStore,
      selectedModel,
      storeView,
    ],
  )

  const submitAction = useCallback(
    async (actionId: string, payload: Record<string, unknown> = {}) => {
      if (!view || isSubmitting) return false
      setRequestError('')
      setIsSubmitting(true)
      try {
        if (actionId !== 'update_model') await doSyncWorkflowDraft()
        const response = await consoleClient.difyBuilder.sessions.bySessionId.actions.post({
          params: { session_id: view.session_id },
          body: { action_id: actionId, base_version: view.version, payload },
        })
        storeView(response)
        return true
      } catch (requestError) {
        setRequestError(await formatError(requestError))
        void refetchSession()
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [doSyncWorkflowDraft, formatError, isSubmitting, refetchSession, storeView, view],
  )

  const updateModel = useCallback(
    async (model: DifyBuilderModelConfigPayload) => {
      if (!view) {
        setSelectedModel(model)
        return true
      }
      const updated = await submitAction('update_model', { model_config: model })
      if (updated) setSelectedModel(model)
      return updated
    },
    [submitAction, view],
  )

  const reset = useCallback(() => {
    setSessionId(null)
    setRequestError('')
    setStreamError('')
    setSelectedModel(null)
    activeSessionIdRef.current = null
    lastCanvasRefreshVersionRef.current = 0
  }, [])

  const value = useMemo<DifyBuilderContextValue>(
    () => ({
      view,
      error,
      isBusy: isSubmitting || isRefreshingCanvas || isSessionFetching,
      selectedModel,
      setSelectedModel,
      startPrompt,
      submitAction,
      updateModel,
      reset,
    }),
    [
      error,
      isRefreshingCanvas,
      isSubmitting,
      reset,
      selectedModel,
      isSessionFetching,
      startPrompt,
      submitAction,
      updateModel,
      view,
    ],
  )

  return <DifyBuilderContext value={value}>{children}</DifyBuilderContext>
}
