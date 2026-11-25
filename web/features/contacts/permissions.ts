import { useAtomValue } from 'jotai'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { isCurrentWorkspaceManagerAtom } from '@/context/workspace-state'
import { rbacEnabledAtom } from '@/features/system-features/state'
import { hasPermission } from '@/utils/permission'

export function useWorkspaceContactPermissions() {
  const rbacEnabled = useAtomValue(rbacEnabledAtom)
  const keys = useAtomValue(workspacePermissionKeysAtom)
  const isWorkspaceManager = useAtomValue(isCurrentWorkspaceManagerAtom)

  return {
    canViewContacts: rbacEnabled ? hasPermission(keys, 'contact.view') : isWorkspaceManager,
    canManageContacts: rbacEnabled ? hasPermission(keys, 'contact.manage') : isWorkspaceManager,
  }
}
