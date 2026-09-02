'use client'

import type { ReactNode } from 'react'
import type { DifyBuilderCanvasNode } from '../utils'
import { ScopeProvider } from 'jotai-scope'
import { useHydrateAtoms } from 'jotai/utils'
import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { useProviderContextSelector } from '@/context/provider-context'
import { difyBuilderSessionScopedAtoms } from '../session/state'
import { useDifyBuilderSessionController } from '../session/use-session-controller'
import { difyBuilderRuntimeAtom, difyBuilderScopedAtoms } from '../store'
import { DifyBuilderCanvasLockSync, DifyBuilderCanvasRefreshSync } from './canvas-sync'
import { DifyBuilderSessionPersistence } from './session-persistence'
import { getSessionStorageKey } from './session-storage'

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
