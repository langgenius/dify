import { useEffect } from 'react'
import type { Permissions } from '../types'
import { PermissionType } from '../types'
import {
  usePluginPageContext,
} from './context'
import { useAppContext } from '@/context/app-context'
import { updatePermission as doUpdatePermission, fetchPermission } from '@/service/plugins'
import Toast from '../../base/toast'
import { useTranslation } from 'react-i18next'

const hasPermission = (permission: PermissionType, isAdmin: boolean) => {
  if (permission === PermissionType.noOne)
    return false

  if (permission === PermissionType.everyone)
    return true

  return isAdmin
}

const usePermission = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner } = useAppContext()
  const [permissions, setPermissions] = usePluginPageContext(v => [v.permissions, v.setPermissions])
  const isAdmin = isCurrentWorkspaceManager || isCurrentWorkspaceOwner

  const updatePermission = async (permission: Permissions) => {
    await doUpdatePermission(permission)
    setPermissions(permission)
    Toast.notify({
      type: 'success',
      message: t('common.api.actionSuccess'),
    })
  }
  useEffect(() => {
    (async () => {
      const permission = await fetchPermission()
      setPermissions(permission)
    })()
  }, [])
  return {
    canManagement: hasPermission(permissions.install_permission, isAdmin),
    canDebugger: hasPermission(permissions.debug_permission, isAdmin),
    canSetPermissions: isAdmin,
    permissions,
    setPermissions: updatePermission,
  }
}

export default usePermission
