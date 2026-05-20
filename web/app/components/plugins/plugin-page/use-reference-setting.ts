import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useInvalidateReferenceSettings, useMutationReferenceSettings, useReferenceSettings } from '@/service/use-plugins'
import { hasPermission } from '@/utils/permission'
import { PermissionType } from '../types'

const hasPluginPermission = (permission: PermissionType | undefined, isAdmin: boolean) => {
  if (!permission)
    return false

  if (permission === PermissionType.noOne)
    return false

  if (permission === PermissionType.everyone)
    return true

  return isAdmin
}

const useReferenceSetting = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner, langGeniusVersionInfo, workspacePermissionKeys } = useAppContext()
  const { data } = useReferenceSettings()

  const { permission: permissions } = data || {}
  const invalidateReferenceSettings = useInvalidateReferenceSettings()
  const { mutate: updateReferenceSetting, isPending: isUpdatePending } = useMutationReferenceSettings({
    onSuccess: () => {
      invalidateReferenceSettings()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })
  const isAdmin = isCurrentWorkspaceManager || isCurrentWorkspaceOwner

  const canInstallPluginByPermissionKey = hasPermission(workspacePermissionKeys, 'plugin.install')
  const canUpdatePlugin = hasPermission(workspacePermissionKeys, ['plugin.install', 'plugin.manage'])
  const canViewInstalledPlugins = canUpdatePlugin
  const canManagePlugin = hasPermission(workspacePermissionKeys, 'plugin.manage')
  const canUninstall = hasPermission(workspacePermissionKeys, ['plugin.uninstall', 'plugin.manage'])
  const canSetPermissions = hasPermission(workspacePermissionKeys, 'plugin.preference.manage')
  const canSetAutoUpdate = hasPermission(workspacePermissionKeys, ['plugin.install', 'plugin.preference.manage'])
  const canSetPreferences = canSetPermissions || canSetAutoUpdate

  return {
    referenceSetting: data,
    setReferenceSettings: updateReferenceSetting,
    canViewInstalledPlugins,
    canInstall: canInstallPluginByPermissionKey && hasPluginPermission(permissions?.install_permission, isAdmin),
    canUpdate: canUpdatePlugin,
    canManagePlugin,
    canUninstall,
    canDebugger: hasPluginPermission(permissions?.debug_permission, isAdmin),
    canSetPermissions,
    canSetAutoUpdate,
    canSetPreferences,
    currentDifyVersion: langGeniusVersionInfo.current_version,
    isUpdatePending,
  }
}

export const useCanInstallPluginFromMarketplace = () => {
  const { data: enable_marketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.enable_marketplace,
  })
  const { canInstall } = useReferenceSetting()

  const canInstallPluginFromMarketplace = useMemo(() => {
    return enable_marketplace && canInstall
  }, [enable_marketplace, canInstall])

  return {
    canInstallPluginFromMarketplace,
  }
}

export default useReferenceSetting
