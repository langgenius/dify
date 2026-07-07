'use client'

import { useSelector as useAppContextSelector } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'

export const useCanManageTools = () => {
  const workspacePermissionKeys = useAppContextSelector(state => state.workspacePermissionKeys)

  return hasPermission(workspacePermissionKeys, 'tool.manage')
}

export const useCanManageMCP = () => {
  const workspacePermissionKeys = useAppContextSelector(state => state.workspacePermissionKeys)

  return hasPermission(workspacePermissionKeys, 'mcp.manage')
}
