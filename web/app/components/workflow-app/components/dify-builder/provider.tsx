'use client'

import type { ReactNode } from 'react'
import type { DifyBuilderCanvasNode } from './utils'
import type { CanvasEventData } from '@/app/components/dify-builder/types'
import { useAtomValue, useStore as useJotaiStore, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { useEffect, useMemo, useRef } from 'react'
import {
  difyBuilderActiveSessionIdAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionLastCanvasEventAtom,
  difyBuilderSessionScopedAtoms,
} from '@/app/components/dify-builder/state'
import { useDifyBuilderSessionController } from '@/app/components/dify-builder/use-dify-builder-session'
import { useStore } from '@/app/components/workflow/store'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { useProviderContextSelector } from '@/context/provider-context'
import {
  difyBuilderCanvasLockedAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshGenerationAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderCanvasRefreshRetryRequestAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderPhaseAtom,
  difyBuilderRuntimeAtom,
  difyBuilderScopedAtoms,
  difyBuilderSessionIdAtom,
  difyBuilderViewVersionAtom,
} from './store'

type DifyBuilderProviderProps = {
  appId?: string
  canEdit: boolean
  children: ReactNode
  getCanvasSnapshot: () => { nodes: DifyBuilderCanvasNode[]; edgeCount: number }
  onFocusCanvas: () => void
  onRefreshCanvas: () => Promise<boolean>
  onSyncDraft: () => Promise<unknown>
  tenantId?: string
  userId?: string
}

const CANVAS_REFRESH_PHASES = new Set(['modify', 'test', 'review', 'publish', 'complete'])
const SESSION_STORAGE_PREFIX = 'dify-builder:v1:'

const getSessionStorageKey = (tenantId?: string, userId?: string, appId?: string) => {
  if (!tenantId || !userId || !appId) return null
  return `${SESSION_STORAGE_PREFIX}${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}:${encodeURIComponent(appId)}:active-session-id`
}

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

const DifyBuilderCanvasLockSync = () => {
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

const DifyBuilderSessionPersistence = ({
  appId,
  enabled,
  restore,
  tenantId,
  userId,
}: {
  appId?: string
  enabled: boolean
  restore: (sessionId: string) => Promise<boolean>
  tenantId?: string
  userId?: string
}) => {
  const activeSessionId = useAtomValue(difyBuilderActiveSessionIdAtom)
  const setActiveSessionId = useSetAtom(difyBuilderActiveSessionIdAtom)
  const jotaiStore = useJotaiStore()
  const storageKey = getSessionStorageKey(tenantId, userId, appId)
  const attemptedStorageKeyRef = useRef<string | null>(null)
  const persistedSessionIdRef = useRef<string | null>(null)
  const restoringRef = useRef(false)

  useEffect(() => {
    if (!enabled || !storageKey || attemptedStorageKeyRef.current === storageKey) return
    attemptedStorageKeyRef.current = storageKey

    let storedSessionId: string | null = null
    try {
      storedSessionId = window.sessionStorage.getItem(storageKey)?.trim() || null
    } catch {
      return
    }
    if (!storedSessionId) return

    persistedSessionIdRef.current = storedSessionId
    restoringRef.current = true
    setActiveSessionId(storedSessionId)
    void restore(storedSessionId)
      .catch(() => undefined)
      .finally(() => {
        restoringRef.current = false
        const currentSessionId = jotaiStore.get(difyBuilderActiveSessionIdAtom)
        try {
          if (currentSessionId) {
            window.sessionStorage.setItem(storageKey, currentSessionId)
            persistedSessionIdRef.current = currentSessionId
          } else if (window.sessionStorage.getItem(storageKey) === storedSessionId) {
            window.sessionStorage.removeItem(storageKey)
            persistedSessionIdRef.current = null
          }
        } catch {
          // Session persistence is optional and must not block Builder recovery.
        }
      })
  }, [enabled, jotaiStore, restore, setActiveSessionId, storageKey])

  useEffect(() => {
    if (!enabled || !storageKey || restoringRef.current) return
    try {
      if (activeSessionId) {
        window.sessionStorage.setItem(storageKey, activeSessionId)
        persistedSessionIdRef.current = activeSessionId
      } else if (persistedSessionIdRef.current) {
        window.sessionStorage.removeItem(storageKey)
        persistedSessionIdRef.current = null
      }
    } catch {
      // Session persistence is a recovery enhancement; storage failures must
      // not block the active Builder flow.
    }
  }, [activeSessionId, enabled, storageKey])

  return null
}

const DifyBuilderCanvasRefreshSync = ({
  onFocusCanvas,
  onRefreshCanvas,
}: Pick<DifyBuilderProviderProps, 'onFocusCanvas' | 'onRefreshCanvas'>) => {
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

const DifyBuilderProviderContent = ({
  appId,
  canEdit,
  children,
  getCanvasSnapshot,
  onFocusCanvas,
  onRefreshCanvas,
  onSyncDraft,
  tenantId,
  userId,
}: DifyBuilderProviderProps) => {
  const enabled = useProviderContextSelector((context) => context.difyBuilderEnabled)
  const setShowPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const session = useDifyBuilderSessionController()
  const runtime = useMemo(
    () => ({
      appId,
      canEdit,
      enabled,
      getCanvasSnapshot,
      onSyncDraft,
      session,
      setShowPanel,
    }),
    [appId, canEdit, enabled, getCanvasSnapshot, onSyncDraft, session, setShowPanel],
  )

  useHydrateAtoms([[difyBuilderRuntimeAtom, runtime]] as const, {
    dangerouslyForceHydrate: true,
  })

  return (
    <>
      <DifyBuilderSessionPersistence
        appId={appId}
        enabled={enabled}
        restore={session.restore}
        tenantId={tenantId}
        userId={userId}
      />
      <DifyBuilderCanvasLockSync />
      <DifyBuilderCanvasRefreshSync
        onFocusCanvas={onFocusCanvas}
        onRefreshCanvas={onRefreshCanvas}
      />
      {children}
    </>
  )
}

export const DifyBuilderProvider = (props: DifyBuilderProviderProps) => {
  const scopeKey = getSessionStorageKey(props.tenantId, props.userId, props.appId) ?? 'unscoped'
  return (
    <ScopeProvider
      key={scopeKey}
      atoms={[...difyBuilderSessionScopedAtoms, ...difyBuilderScopedAtoms]}
      name="DifyBuilder"
    >
      <DifyBuilderProviderContent {...props} />
    </ScopeProvider>
  )
}
