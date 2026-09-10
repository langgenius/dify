'use client'

import { skipToken, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import {
  agentDefaultPermissionKeysAtom,
  workspacePermissionKeysAtom,
} from '@/context/permission-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import { AgentPermission, getAgentACLCapabilities } from './acl'

export function useCanCreateAgents() {
  return hasPermission(useAtomValue(workspacePermissionKeysAtom), AgentPermission.Create)
}

export function useCanImportAgents() {
  return hasPermission(
    useAtomValue(agentDefaultPermissionKeysAtom),
    AgentPermission.ImportExportDSL,
  )
}

export function useAgentPermissions(agentId: string | undefined) {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const agentQuery = useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: agentId ? { params: { agent_id: agentId } } : skipToken,
    }),
  )

  const capabilities = getAgentACLCapabilities(agentQuery.data?.permission_keys)
  return {
    agentQuery,
    ...capabilities,
    canAccessConfig: capabilities.canAccessConfig && systemFeatures.rbac_enabled,
  }
}
