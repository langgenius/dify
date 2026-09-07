'use client'

import { useAtomValue } from 'jotai'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'

const AGENT_PREVIEW_PERMISSION_KEY = 'agent.acl.preview'

export const useCanManageAgents = () => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return hasPermission(workspacePermissionKeys, AGENT_PREVIEW_PERMISSION_KEY)
}
