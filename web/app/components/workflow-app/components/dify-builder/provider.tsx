'use client'

import type { ReactNode } from 'react'
import type { DifyBuilderCanvasNode } from './utils'
import { useAtomValue, useSetAtom } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { useEffect, useMemo, useRef } from 'react'
import { difyBuilderSessionScopedAtoms } from '@/app/components/dify-builder/state'
import { useDifyBuilderSessionController } from '@/app/components/dify-builder/use-dify-builder-session'
import { useStore } from '@/app/components/workflow/store'
import { API_PREFIX } from '@/config'
import {
  difyBuilderCanvasLockedAtom,
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
  onRefreshCanvas: () => Promise<unknown>
  onSyncDraft: () => Promise<unknown>
}

const CANVAS_REFRESH_PHASES = new Set(['modify', 'test', 'review', 'publish', 'complete'])

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

const DifyBuilderCanvasRefreshSync = ({
  onRefreshCanvas,
}: Pick<DifyBuilderProviderProps, 'onRefreshCanvas'>) => {
  const sessionId = useAtomValue(difyBuilderSessionIdAtom)
  const version = useAtomValue(difyBuilderViewVersionAtom)
  const phase = useAtomValue(difyBuilderPhaseAtom)
  const setLocalError = useSetAtom(difyBuilderLocalErrorAtom)
  const lastRefreshRef = useRef<{ sessionId: string; version: number } | null>(null)

  useEffect(() => {
    if (!sessionId) {
      lastRefreshRef.current = null
      return
    }

    const lastRefresh = lastRefreshRef.current
    if (lastRefresh?.sessionId === sessionId && version <= lastRefresh.version) return
    lastRefreshRef.current = { sessionId, version }
    if (!phase || !CANVAS_REFRESH_PHASES.has(phase)) return

    void onRefreshCanvas().catch((error) => setLocalError(String(error)))
  }, [onRefreshCanvas, phase, sessionId, setLocalError, version])

  return null
}

const DifyBuilderProviderContent = ({
  appId,
  canEdit,
  children,
  getCanvasSnapshot,
  onRefreshCanvas,
  onSyncDraft,
}: DifyBuilderProviderProps) => {
  const setShowPanel = useStore((state) => state.setShowDifyBuilderPanel)
  const session = useDifyBuilderSessionController({ baseUrl: API_PREFIX })
  const runtime = useMemo(
    () => ({
      appId,
      canEdit,
      getCanvasSnapshot,
      onSyncDraft,
      session,
      setShowPanel,
    }),
    [appId, canEdit, getCanvasSnapshot, onSyncDraft, session, setShowPanel],
  )

  useHydrateAtoms([[difyBuilderRuntimeAtom, runtime]] as const, {
    dangerouslyForceHydrate: true,
  })

  return (
    <>
      <DifyBuilderCanvasLockSync />
      <DifyBuilderCanvasRefreshSync onRefreshCanvas={onRefreshCanvas} />
      {children}
    </>
  )
}

export const DifyBuilderProvider = (props: DifyBuilderProviderProps) => {
  return (
    <ScopeProvider
      key={props.appId}
      atoms={[...difyBuilderSessionScopedAtoms, ...difyBuilderScopedAtoms]}
      name="DifyBuilder"
    >
      <DifyBuilderProviderContent {...props} />
    </ScopeProvider>
  )
}
