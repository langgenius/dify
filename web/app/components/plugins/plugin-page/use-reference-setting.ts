import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useInvalidateReferenceSettings, useMutationReferenceSettings, useReferenceSettings } from '@/service/use-plugins'
import { hasPermission } from '@/utils/permission'

const useReferenceSetting = () => {
  const { t } = useTranslation()
  const { langGeniusVersionInfo, workspacePermissionKeys } = useAppContext()
  const { data } = useReferenceSettings()

  const invalidateReferenceSettings = useInvalidateReferenceSettings()
  const { mutate: updateReferenceSetting, isPending: isUpdatePending } = useMutationReferenceSettings({
    onSuccess: () => {
      invalidateReferenceSettings()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })

  const canInstallPluginByPermissionKey = hasPermission(workspacePermissionKeys, 'plugin.install')
  const canUpdatePlugin = hasPermission(workspacePermissionKeys, ['plugin.install', 'plugin.manage'])
  const canViewInstalledPlugins = canUpdatePlugin
  const canManagePlugin = hasPermission(workspacePermissionKeys, 'plugin.manage')
  const canUninstall = canManagePlugin
  const canDebugger = hasPermission(workspacePermissionKeys, 'plugin.debug')
  const canSetPermissions = hasPermission(workspacePermissionKeys, 'plugin.plugin_preferences')
  const canSetAutoUpdate = hasPermission(workspacePermissionKeys, 'plugin.plugin_preferences')
  const canSetPreferences = canSetPermissions || canSetAutoUpdate

  return {
    referenceSetting: data,
    setReferenceSettings: updateReferenceSetting,
    canViewInstalledPlugins,
    canInstall: canInstallPluginByPermissionKey,
    canUpdate: canUpdatePlugin,
    canManagePlugin,
    canUninstall,
    canDebugger,
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
