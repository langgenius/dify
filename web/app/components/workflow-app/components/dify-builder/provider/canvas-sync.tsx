import { useAtomValue, useStore as useJotaiStore, useSetAtom } from 'jotai'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { requestErrorMessage } from '../session/errors'
import { difyBuilderSessionBusyAtom } from '../session/state'
import {
  DIFY_BUILDER_CANVAS_REFRESH_PHASES,
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasLockedAtom,
  difyBuilderCanvasPendingRefreshAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderCanvasRefreshRetryRequestAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderPhaseAtom,
  difyBuilderSessionIdAtom,
  difyBuilderViewVersionAtom,
} from '../store'

export const DifyBuilderCanvasLockSync = () => {
  const locked = useAtomValue(difyBuilderCanvasLockedAtom)
  const setCanvasReadOnly = useStore((state) => state.setCanvasReadOnly)

  useLayoutEffect(() => {
    setCanvasReadOnly(locked)
  }, [locked, setCanvasReadOnly])

  useEffect(() => {
    return () => setCanvasReadOnly(false)
  }, [setCanvasReadOnly])

  return null
}

export const DifyBuilderCanvasRefreshSync = ({
  onRefreshCanvas,
  onCanvasRefreshed,
}: {
  onRefreshCanvas: (shouldApply: () => boolean) => Promise<boolean>
  onCanvasRefreshed: () => void
}) => {
  const sessionStore = useJotaiStore()
  const builderNeedsRefresh = useStore((state) => state.workflowDraftSyncPhase === 'builder')
  const busy = useAtomValue(difyBuilderSessionBusyAtom)
  const pendingRefresh = useAtomValue(difyBuilderCanvasPendingRefreshAtom)
  const setPendingRefresh = useSetAtom(difyBuilderCanvasPendingRefreshAtom)
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const version = useAtomValue(difyBuilderViewVersionAtom)
  const phase = useAtomValue(difyBuilderPhaseAtom)
  const retryRequest = useAtomValue(difyBuilderCanvasRefreshRetryRequestAtom)
  const setCanvasRefreshFailed = useSetAtom(difyBuilderCanvasRefreshFailedAtom)
  const setCanvasAppliedView = useSetAtom(difyBuilderCanvasAppliedViewAtom)
  const setCanvasRefreshGeneration = useSetAtom(difyBuilderCanvasRefreshGenerationAtom)
  const setCanvasRefreshing = useSetAtom(difyBuilderCanvasRefreshingAtom)
  const setLocalError = useSetAtom(difyBuilderLocalErrorAtom)
  const lastRefreshRef = useRef<{
    sessionId: string | null
    version: number
    request: typeof pendingRefresh
  } | null>(null)
  const lastRetryRequestRef = useRef(0)
  const refreshRequestIdRef = useRef(0)

  useEffect(
    () => () => {
      refreshRequestIdRef.current += 1
      lastRefreshRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (busy) {
      refreshRequestIdRef.current += 1
      if (sessionStore.get(difyBuilderCanvasRefreshingAtom)) lastRefreshRef.current = null
      return
    }

    if (!sessionId && !builderNeedsRefresh) {
      refreshRequestIdRef.current += 1
      lastRefreshRef.current = null
      lastRetryRequestRef.current = retryRequest
      setPendingRefresh(null)
      setCanvasRefreshing(false)
      setCanvasRefreshFailed(false)
      setCanvasAppliedView(null)
      return
    }

    const lastRefresh = lastRefreshRef.current
    const request = pendingRefresh?.sessionId === sessionId ? pendingRefresh : null
    const eventNeedsRefresh = request && request !== lastRefresh?.request
    const versionNeedsRefresh =
      (!lastRefresh || lastRefresh.sessionId !== sessionId || version > lastRefresh.version) &&
      !!phase &&
      DIFY_BUILDER_CANVAS_REFRESH_PHASES.has(phase)
    const retryRequested = retryRequest > lastRetryRequestRef.current
    if (!retryRequested && !eventNeedsRefresh && !versionNeedsRefresh && !builderNeedsRefresh)
      return

    lastRefreshRef.current = { sessionId, version, request }
    lastRetryRequestRef.current = retryRequest

    const requestId = ++refreshRequestIdRef.current
    setCanvasRefreshing(true)
    setLocalError('')

    const shouldApply = () =>
      requestId === refreshRequestIdRef.current &&
      sessionStore.get(difyBuilderSessionIdAtom) === sessionId &&
      sessionStore.get(difyBuilderViewVersionAtom) === version &&
      !sessionStore.get(difyBuilderSessionBusyAtom)
    const refreshPromise = onRefreshCanvas(shouldApply)
    void refreshPromise
      .then((refreshed) => {
        if (!shouldApply()) return
        if (!refreshed) {
          setCanvasRefreshFailed(true)
          setLocalError('Workflow canvas refresh failed.')
          return
        }
        setCanvasRefreshGeneration((generation) => generation + 1)
        setCanvasAppliedView(sessionId ? { sessionId, version } : null)
        setCanvasRefreshFailed(false)
        setCanvasRefreshing(false)
        if (sessionStore.get(difyBuilderCanvasPendingRefreshAtom) === request)
          setPendingRefresh(null)
        const nodeId = request?.focusNodeId
        if (nodeId) selectWorkflowNode(nodeId, true)
        onCanvasRefreshed()
      })
      .catch(async (error: unknown) => {
        const message = await requestErrorMessage(error)
        if (!shouldApply()) return
        setCanvasRefreshFailed(true)
        setLocalError(message)
      })
      .finally(() => {
        if (requestId === refreshRequestIdRef.current) setCanvasRefreshing(false)
      })
  }, [
    builderNeedsRefresh,
    busy,
    pendingRefresh,
    onCanvasRefreshed,
    onRefreshCanvas,
    phase,
    retryRequest,
    sessionId,
    sessionStore,
    setCanvasAppliedView,
    setCanvasRefreshFailed,
    setCanvasRefreshGeneration,
    setCanvasRefreshing,
    setLocalError,
    setPendingRefresh,
    version,
  ])

  return null
}
