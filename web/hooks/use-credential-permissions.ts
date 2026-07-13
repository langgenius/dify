import { useAtomValue } from 'jotai'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'

export const useCredentialPermissions = () => {
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)

  return {
    canUseCredential: hasPermission(workspacePermissionKeys, 'credential.use'),
    canCreateCredential: hasPermission(workspacePermissionKeys, 'credential.create'),
    canManageCredential: hasPermission(workspacePermissionKeys, 'credential.manage'),
  }
}
