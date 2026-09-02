import type { CanvasEventData } from '../types'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { difyBuilderSessionBusyAtom, difyBuilderSessionLastCanvasEventAtom } from '../session/state'
import {
  difyBuilderCanvasLockedAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderCanvasRefreshRetryRequestAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderPhaseAtom,
  difyBuilderSessionIdAtom,
  difyBuilderViewVersionAtom,
} from '../store'

const CANVAS_REFRESH_PHASES = new Set(['modify', 'test', 'review', 'publish', 'complete'])

type CanvasInstruction = {
  focus: 'canvas' | 'node_now' | 'node_after_refresh' | 'none'
  refresh: boolean
}

const getCanvasInstruction = (data: CanvasEventData): CanvasInstruction => {
  const event = data.event
  switch (event) {
    case 'focus_workflow':
      return { focus: 'canvas', refresh: false }
    case 'highlight_edit_target':
    case 'focus_error_node':
    case 'focus_checklist_node':
    case 'mark_test_error':
      return { focus: data.node_id ? 'node_now' : 'none', refresh: false }
    case 'reset_build_canvas':
    case 'revert_checkpoint':
      return { focus: 'none', refresh: true }
    case 'add_start_node':
    case 'add_knowledge_node':
    case 'add_llm_node':
    case 'add_output_node':
    case 'apply_edit_plan':
    case 'apply_error_fix':
    case 'mark_repair_applied':
    case 'apply_preflight_fix':
      return { focus: data.node_id ? 'node_after_refresh' : 'none', refresh: true }
    case 'create_checkpoint':
    case 'start_test_run':
    case 'start_retest':
    case 'mark_test_success':
    case 'mark_review_ready':
    case 'cancel_publish':
    case 'publish_workflow':
      return { focus: 'none', refresh: false }
    default:
      event satisfies never
      return { focus: 'none', refresh: false }
  }
}

export const DifyBuilderCanvasLockSync = () => {
  const locked = useAtomValue(difyBuilderCanvasLockedAtom)
  const setCanvasReadOnly = useStore((state) => state.setCanvasReadOnly)

  useEffect(() => {
    setCanvasReadOnly(locked)
  }, [locked, setCanvasReadOnly])

  useEffect(() => {
    return () => setCanvasReadOnly(false)
  }, [setCanvasReadOnly])

  return null
}

export const DifyBuilderCanvasRefreshSync = ({
  onFocusCanvas,
  onRefreshCanvas,
}: {
  onFocusCanvas: () => void
  onRefreshCanvas: () => Promise<boolean>
}) => {
  const busy = useAtomValue(difyBuilderSessionBusyAtom)
  const lastCanvasEvent = useAtomValue(difyBuilderSessionLastCanvasEventAtom)
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const version = useAtomValue(difyBuilderViewVersionAtom)
  const phase = useAtomValue(difyBuilderPhaseAtom)
  const retryRequest = useAtomValue(difyBuilderCanvasRefreshRetryRequestAtom)
  const setCanvasRefreshFailed = useSetAtom(difyBuilderCanvasRefreshFailedAtom)
  const setCanvasRefreshGeneration = useSetAtom(difyBuilderCanvasRefreshGenerationAtom)
  const setCanvasRefreshing = useSetAtom(difyBuilderCanvasRefreshingAtom)
  const setLocalError = useSetAtom(difyBuilderLocalErrorAtom)
  const lastCanvasEventIdRef = useRef(0)
  const lastRefreshRef = useRef<{ sessionId: string; version: number } | null>(null)
  const lastRetryRequestRef = useRef(0)
  const pendingFocusNodeIdRef = useRef<string | null>(null)
  const pendingRefreshRef = useRef(false)
  const refreshQueueRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const refreshRequestIdRef = useRef(0)

  useEffect(() => {
    if (lastCanvasEvent && lastCanvasEvent.id > lastCanvasEventIdRef.current) {
      lastCanvasEventIdRef.current = lastCanvasEvent.id
      const instruction = getCanvasInstruction(lastCanvasEvent.data)
      if (instruction.focus === 'canvas') onFocusCanvas()
      if (instruction.focus === 'node_now' && lastCanvasEvent.data.node_id)
        selectWorkflowNode(lastCanvasEvent.data.node_id, true)
      if (instruction.focus === 'node_after_refresh' && lastCanvasEvent.data.node_id)
        pendingFocusNodeIdRef.current = lastCanvasEvent.data.node_id
      if (instruction.refresh) pendingRefreshRef.current = true
    }

    if (!sessionId) {
      refreshRequestIdRef.current += 1
      lastCanvasEventIdRef.current = 0
      lastRefreshRef.current = null
      lastRetryRequestRef.current = retryRequest
      pendingFocusNodeIdRef.current = null
      pendingRefreshRef.current = false
      setCanvasRefreshing(false)
      setCanvasRefreshFailed(false)
      return
    }

    const lastRefresh = lastRefreshRef.current
    const versionNeedsRefresh =
      (!lastRefresh || lastRefresh.sessionId !== sessionId || version > lastRefresh.version) &&
      !!phase &&
      CANVAS_REFRESH_PHASES.has(phase)
    const retryRequested = retryRequest > lastRetryRequestRef.current
    if (busy || (!retryRequested && !pendingRefreshRef.current && !versionNeedsRefresh)) return

    lastRefreshRef.current = { sessionId, version }
    lastRetryRequestRef.current = retryRequest
    pendingRefreshRef.current = false

    const requestId = ++refreshRequestIdRef.current
    setCanvasRefreshing(true)
    setLocalError('')

    const refreshPromise = refreshQueueRef.current.catch(() => false).then(onRefreshCanvas)
    refreshQueueRef.current = refreshPromise
    void refreshPromise
      .then((refreshed) => {
        if (requestId !== refreshRequestIdRef.current) return
        if (!refreshed) {
          setCanvasRefreshFailed(true)
          setLocalError('Workflow canvas refresh failed.')
          return
        }
        setCanvasRefreshGeneration((generation) => generation + 1)
        setCanvasRefreshFailed(false)
        const nodeId = pendingFocusNodeIdRef.current
        pendingFocusNodeIdRef.current = null
        if (nodeId) selectWorkflowNode(nodeId, true)
      })
      .catch((error) => {
        if (requestId !== refreshRequestIdRef.current) return
        setCanvasRefreshFailed(true)
        setLocalError(String(error))
      })
      .finally(() => {
        if (requestId === refreshRequestIdRef.current) setCanvasRefreshing(false)
      })
  }, [
    busy,
    lastCanvasEvent,
    onFocusCanvas,
    onRefreshCanvas,
    phase,
    retryRequest,
    sessionId,
    setCanvasRefreshFailed,
    setCanvasRefreshGeneration,
    setCanvasRefreshing,
    setLocalError,
    version,
  ])

  return null
}
