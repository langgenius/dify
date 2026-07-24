'use client'

import type { ReactNode } from 'react'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import Loading from '@/app/components/base/loading'
import { currentWorkspaceIdAtom, currentWorkspaceLoadingAtom } from '@/context/workspace-state'
import { useCanManageAgents } from '@/features/agent-v2/permissions'
import { useRouter } from '@/next/navigation'

export function AgentsAccessGuard({ children }: { children: ReactNode }) {
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)
  const isLoadingCurrentWorkspace = useAtomValue(currentWorkspaceLoadingAtom)
  const canManageAgents = useCanManageAgents()
  const router = useRouter()
  const shouldRedirect = !isLoadingCurrentWorkspace && !!currentWorkspaceId && !canManageAgents

  useEffect(() => {
    if (shouldRedirect) router.replace('/')
  }, [shouldRedirect, router])

  if (isLoadingCurrentWorkspace || !currentWorkspaceId) return <Loading type="app" />

  if (shouldRedirect) return null

  return children
}
