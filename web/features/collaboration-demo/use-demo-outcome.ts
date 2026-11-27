import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import {
  currentWorkspaceLoadingAtom,
  isCurrentWorkspaceManagerAtom,
} from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { getDemoEndState } from './end-state'

export function useDemoOutcome() {
  const canManageBilling = useAtomValue(isCurrentWorkspaceManagerAtom)
  const workspaceLoading = useAtomValue(currentWorkspaceLoadingAtom)
  const features = useQuery(consoleQuery.features.get.queryOptions())
  if (workspaceLoading) return { kind: 'loading' } as const
  return getDemoEndState({
    features: features.data
      ? {
          status: 'success',
          collaborationEnabled: features.data.workflow_collaboration_enabled === true,
          upgradeAvailable: features.data.workflow_collaboration_upgrade_available === true,
        }
      : features.isError
        ? { status: 'error' }
        : { status: 'pending' },
    canManageBilling,
  })
}
