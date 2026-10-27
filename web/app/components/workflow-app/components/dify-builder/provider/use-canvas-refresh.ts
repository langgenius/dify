import type { WorkflowDraftRefreshResult } from '../../../hooks/use-workflow-refresh-draft'
import { useStore as useJotaiStore } from 'jotai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { requestErrorMessage } from '../session/errors'
import {
  difyBuilderActiveCommandAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
  difyBuilderTaskControlAtom,
} from '../session/state'
import {
  DIFY_BUILDER_CANVAS_REFRESH_PHASES,
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasPendingRefreshAtom,
  difyBuilderCanvasReadyAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderSessionIdAtom,
  difyBuilderViewVersionAtom,
} from '../store'

export const useDifyBuilderCanvasRefresh = (
  onRefreshCanvas: (shouldApply: () => boolean) => Promise<WorkflowDraftRefreshResult>,
  onCanvasRefreshed: () => void,
) => {
  const { t } = useTranslation(['difyBuilder'])
  const sessionStore = useJotaiStore()
  const workflowStore = useWorkflowStore()
  const lastRefreshRef = useRef<{
    sessionId: string | null
    version: number
    request: { sessionId: string } | null
  } | null>(null)
  const refreshRequestIdRef = useRef(0)
  const syncCanvasLock = useCallback(() => {
    const locked =
      sessionStore.get(difyBuilderSessionBusyAtom) ||
      sessionStore.get(difyBuilderTaskControlAtom) !== null ||
      !sessionStore.get(difyBuilderCanvasReadyAtom) ||
      !!sessionStore.get(difyBuilderSessionViewAtom)?.canvas_read_only
    const { canvasReadOnly, setCanvasReadOnly } = workflowStore.getState()
    if (canvasReadOnly !== locked) setCanvasReadOnly(locked)
  }, [sessionStore, workflowStore])

  useEffect(
    () => () => {
      refreshRequestIdRef.current += 1
      lastRefreshRef.current = null
    },
    [],
  )

  const cancel = useCallback(() => {
    refreshRequestIdRef.current += 1
    if (sessionStore.get(difyBuilderCanvasRefreshingAtom)) lastRefreshRef.current = null
    sessionStore.set(difyBuilderCanvasRefreshingAtom, false)
    syncCanvasLock()
  }, [sessionStore, syncCanvasLock])

  const reset = useCallback(() => {
    refreshRequestIdRef.current += 1
    lastRefreshRef.current = null
    sessionStore.set(difyBuilderCanvasRefreshingAtom, false)
    sessionStore.set(difyBuilderCanvasPendingRefreshAtom, null)
    sessionStore.set(difyBuilderCanvasAppliedViewAtom, null)
    sessionStore.set(difyBuilderCanvasRefreshFailedAtom, false)
    syncCanvasLock()
  }, [sessionStore, syncCanvasLock])

  const refresh = useCallback(
    async (force = false) => {
      if (sessionStore.get(difyBuilderSessionBusyAtom)) {
        syncCanvasLock()
        return
      }
      const sessionId = sessionStore.get(difyBuilderSessionIdAtom)
      const version = sessionStore.get(difyBuilderViewVersionAtom)
      const phase =
        sessionStore.get(difyBuilderActiveCommandAtom)?.phase ??
        sessionStore.get(difyBuilderSessionViewAtom)?.phase
      const builderNeedsRefresh = workflowStore.getState().workflowDraftSyncPhase === 'builder'
      if (!sessionId && !builderNeedsRefresh) {
        reset()
        return
      }
      const pending = sessionStore.get(difyBuilderCanvasPendingRefreshAtom)
      const request = pending?.sessionId === sessionId ? pending : null
      const lastRefresh = lastRefreshRef.current
      const eventNeedsRefresh = request && request !== lastRefresh?.request
      const versionNeedsRefresh =
        (!lastRefresh || lastRefresh.sessionId !== sessionId || version > lastRefresh.version) &&
        !!phase &&
        DIFY_BUILDER_CANVAS_REFRESH_PHASES.has(phase)
      if (
        !force &&
        !eventNeedsRefresh &&
        !versionNeedsRefresh &&
        !(builderNeedsRefresh && !lastRefresh)
      ) {
        syncCanvasLock()
        return
      }

      lastRefreshRef.current = { sessionId, version, request }
      const requestId = ++refreshRequestIdRef.current
      sessionStore.set(difyBuilderCanvasRefreshingAtom, true)
      sessionStore.set(difyBuilderLocalErrorAtom, '')
      syncCanvasLock()
      const shouldApply = () =>
        requestId === refreshRequestIdRef.current &&
        sessionStore.get(difyBuilderSessionIdAtom) === sessionId &&
        sessionStore.get(difyBuilderViewVersionAtom) === version &&
        !sessionStore.get(difyBuilderSessionBusyAtom)

      try {
        let result: WorkflowDraftRefreshResult = 'failed'
        for (let attempt = 0; attempt < 3; attempt += 1) {
          result = await onRefreshCanvas(shouldApply)
          if (!shouldApply()) return
          if (result !== 'superseded') break
        }
        if (result !== 'refreshed') {
          sessionStore.set(difyBuilderCanvasRefreshFailedAtom, true)
          sessionStore.set(
            difyBuilderLocalErrorAtom,
            t(($) => $.canvasRefreshFailed, { reason: '' }).trim(),
          )
          return
        }
        sessionStore.set(difyBuilderCanvasRefreshGenerationAtom, (generation) => generation + 1)
        sessionStore.set(
          difyBuilderCanvasAppliedViewAtom,
          sessionId ? { sessionId, version } : null,
        )
        sessionStore.set(difyBuilderCanvasRefreshFailedAtom, false)
        sessionStore.set(difyBuilderCanvasRefreshingAtom, false)
        if (sessionStore.get(difyBuilderCanvasPendingRefreshAtom) === request)
          sessionStore.set(difyBuilderCanvasPendingRefreshAtom, null)
        onCanvasRefreshed()
      } catch (error: unknown) {
        const message = await requestErrorMessage(error, '')
        if (!shouldApply()) return
        sessionStore.set(difyBuilderCanvasRefreshFailedAtom, true)
        sessionStore.set(
          difyBuilderLocalErrorAtom,
          t(($) => $.canvasRefreshFailed, { reason: message }).trim(),
        )
      } finally {
        if (requestId === refreshRequestIdRef.current) {
          sessionStore.set(difyBuilderCanvasRefreshingAtom, false)
          syncCanvasLock()
        }
      }
    },
    [onCanvasRefreshed, onRefreshCanvas, reset, sessionStore, syncCanvasLock, t, workflowStore],
  )

  const retry = useCallback(() => {
    void refresh(true)
  }, [refresh])
  const finishCommand = useCallback(() => {
    void refresh(
      workflowStore.getState().workflowDraftSyncPhase === 'builder' ||
        sessionStore.get(difyBuilderCanvasAppliedViewAtom) === null,
    )
  }, [refresh, sessionStore, workflowStore])
  return useMemo(
    () => ({ refresh, retry, cancel, reset, finishCommand }),
    [refresh, retry, cancel, reset, finishCommand],
  )
}
