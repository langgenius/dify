'use client'

import { useSuspenseQuery } from '@tanstack/react-query'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'

const AGENT_MANAGE_PERMISSION_KEY = 'agent.manage'

export const useCanManageAgents = () => {
  const { data: permissionSnapshot } = useSuspenseQuery(
    consoleQuery.workspaces.current.rbac.myPermissions.get.queryOptions(),
  )
  const workspacePermissionKeys = permissionSnapshot.workspace?.permission_keys ?? []

  return hasPermission(workspacePermissionKeys, AGENT_MANAGE_PERMISSION_KEY)
}
