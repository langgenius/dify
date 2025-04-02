import { PermissionType } from '../types'
import { useAppContext } from '@/context/app-context'
import Toast from '../../base/toast'
import { useTranslation } from 'react-i18next'
import { useInvalidatePermissions, useMutationPermissions, usePermissions } from '@/service/use-plugins'

const hasPermission = (permission: PermissionType | undefined, isAdmin: boolean) => {
  if (isAdmin)
    return true // Administrators always have permissions

  if (!permission)
    return false

  if (permission === PermissionType.noOne)
    return false

  if (permission === PermissionType.everyone)
    return true

  return false
}

const usePermission = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner } = useAppContext()
  const { data: permissions } = usePermissions()
  const invalidatePermissions = useInvalidatePermissions()
  const { mutate: updatePermission, isPending: isUpdatePending } = useMutationPermissions({
    onSuccess: () => {
      invalidatePermissions()
      Toast.notify({
        type: 'success',
        message: t('common.api.actionSuccess'),
      })
    },
  })
  const isAdmin = isCurrentWorkspaceManager || isCurrentWorkspaceOwner

  return {
    canManagement: hasPermission(permissions?.install_permission, isAdmin),
    canDebugger: hasPermission(permissions?.debug_permission, isAdmin),
    canSetPermissions: isAdmin,
    permissions,
    setPermissions: updatePermission,
    isUpdatePending,
  }
}

export default usePermission
