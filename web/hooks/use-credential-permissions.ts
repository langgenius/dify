import { useSelector as useAppContextSelector } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'

export const useCredentialPermissions = () => {
  const workspacePermissionKeys = useAppContextSelector(state => state.workspacePermissionKeys)

  return {
    canUseCredential: hasPermission(workspacePermissionKeys, ['credential.use', 'credential.manage']),
    canManageCredential: hasPermission(workspacePermissionKeys, 'credential.manage'),
  }
}
