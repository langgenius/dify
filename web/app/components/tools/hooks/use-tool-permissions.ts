'use client'

import { useAtomValue } from 'jotai'
import { workspacePermissionKeysAtom } from '@/context/app-context-state'
import { hasPermission } from '@/utils/permission'

export const useCanManageTools = () => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return hasPermission(workspacePermissionKeys, 'tool.manage')
}

export const useCanManageMCP = () => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return hasPermission(workspacePermissionKeys, 'mcp.manage')
}
