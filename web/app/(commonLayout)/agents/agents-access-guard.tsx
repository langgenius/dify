'use client'

import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { workspacePermissionKeysLoadingAtom } from '@/context/permission-state'
import { currentWorkspaceIdAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { useCanManageAgents } from '@/features/agent-v2/permissions'
import { useRouter } from '@/next/navigation'

export function AgentsAccessGuard({ children }: { children: ReactNode }) {
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const isLoadingWorkspacePermissionKeys = useAtomValue(workspacePermissionKeysLoadingAtom)
  const canManageAgents = useCanManageAgents()
  const router = useRouter()
  const isLoadingAccess = isLoadingCurrentWorkspace || isLoadingWorkspacePermissionKeys
  const shouldRedirect = !isLoadingAccess && !!currentWorkspaceId && !canManageAgents

  useEffect(() => {
    if (shouldRedirect) router.replace('/')
  }, [shouldRedirect, router])

  if (isLoadingAccess || !currentWorkspaceId) return <Loading type="app" />

  if (shouldRedirect) return null

  return children
}
