'use client'

import { useAtomValue } from 'jotai'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'

export const AGENT_MANAGE_PERMISSION_KEY = 'agent.manage'

export const useCanManageAgents = () => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return hasPermission(workspacePermissionKeys, AGENT_MANAGE_PERMISSION_KEY)
}
