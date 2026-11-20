import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { consoleQuery } from '@/service/console'
import { canEditApps, getDemoEndState, pickLatestApp } from './end-state'

function useLatestApp(enabled: boolean) {
  const query = (mode: 'workflow' | 'advanced-chat') =>
    consoleQuery.apps.get.queryOptions({
      input: { query: { page: 1, limit: 1, mode, sort_by: 'last_modified' } },
      enabled,
    })
  const workflows = useQuery(query('workflow'))
  const chatflows = useQuery(query('advanced-chat'))
  if (workflows.isError || chatflows.isError) return { status: 'error' } as const
  if (!workflows.data || !chatflows.data) return { status: 'pending' } as const
  return {
    status: 'success',
    latest: pickLatestApp(workflows.data.data[0], chatflows.data.data[0]),
  } as const
}

export function useDemoOutcome() {
  const role = useAtomValue(currentWorkspaceAtom).role
  const features = useQuery(consoleQuery.features.get.queryOptions())
  const collaborationEnabled = features.data?.workflow_collaboration_enabled === true
  const apps = useLatestApp(collaborationEnabled && canEditApps(role))
  return getDemoEndState({
    features: features.data
      ? {
          status: 'success',
          collaborationEnabled,
          upgradeAvailable: features.data.workflow_collaboration_upgrade_available === true,
        }
      : features.isError
        ? { status: 'error' }
        : { status: 'pending' },
    role,
    apps,
  })
}
