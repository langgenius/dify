import type { PluginCategoryEnum } from '../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useInvalidateReferenceSettings, useMutationPluginPermissionSettings, useMutationReferenceSettings, usePluginAutoUpgradeSettings, usePluginPermissionSettings } from '@/service/use-plugins'
import { hasPermission } from '@/utils/permission'
import { hasLegacyPluginPermissionAccess } from '../plugin-permissions'

const useCanSetPluginSettings = () => {
  const { workspacePermissionKeys } = useAppContext()
  const { data: rbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.rbac_enabled,
  })
  const canSetPluginPreferences = hasPermission(workspacePermissionKeys, 'plugin.plugin_preferences')

  return {
    canSetPermissions: !rbacEnabled && canSetPluginPreferences,
    canSetPluginPreferences,
  }
}

export const usePluginSettingsAccess = () => {
  const { t } = useTranslation()
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner, workspacePermissionKeys, langGeniusVersionInfo } = useAppContext()
  const { data: rbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.rbac_enabled,
  })
  const { canSetPermissions, canSetPluginPreferences } = useCanSetPluginSettings()
  const permissionQuery = usePluginPermissionSettings()
  const { data: permissions } = permissionQuery
  const { mutate: setPluginPermissionSettings, isPending: isPermissionUpdatePending } = useMutationPluginPermissionSettings({
    onSuccess: () => {
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })
  const isAdminOrOwner = isCurrentWorkspaceManager || isCurrentWorkspaceOwner
  const legacyCanInstallPlugin = hasLegacyPluginPermissionAccess({
    isAdminOrOwner,
    permission: permissions?.install_permission,
    rbacEnabled,
  })
  const legacyCanDebugPlugin = hasLegacyPluginPermissionAccess({
    isAdminOrOwner,
    permission: permissions?.debug_permission,
    rbacEnabled,
  })
  const canInstallPlugin = hasPermission(workspacePermissionKeys, 'plugin.install') && legacyCanInstallPlugin
  const canUpdatePlugin = hasPermission(workspacePermissionKeys, 'plugin.install') && legacyCanInstallPlugin
  const canDeletePlugin = hasPermission(workspacePermissionKeys, 'plugin.delete') && legacyCanInstallPlugin
  const canDebugPlugin = rbacEnabled
    ? hasPermission(workspacePermissionKeys, 'plugin.debug')
    : legacyCanDebugPlugin

  return {
    permission: permissions,
    setPluginPermissionSettings,
    canInstallPlugin,
    canUpdatePlugin,
    canDeletePlugin,
    canDebugPlugin,
    canSetPluginPreferences,
    canManagement: canInstallPlugin,
    canDebugger: canDebugPlugin,
    canSetPermissions,
    currentDifyVersion: langGeniusVersionInfo?.current_version,
    isPermissionLoading: permissionQuery.isLoading || permissionQuery.isFetching,
    permissionError: permissionQuery.error,
    isPermissionUpdatePending,
  }
}

const useReferenceSetting = (category: PluginCategoryEnum) => {
  const { t } = useTranslation()
  const permissionAccess = usePluginSettingsAccess()
  const autoUpgradeQuery = usePluginAutoUpgradeSettings(category)
  const data = permissionAccess.permission && autoUpgradeQuery.data?.auto_upgrade
    ? {
        permission: permissionAccess.permission,
        auto_upgrade: autoUpgradeQuery.data.auto_upgrade,
      }
    : undefined
  const invalidateReferenceSettings = useInvalidateReferenceSettings()
  const { mutate: updateReferenceSetting, isPending: isUpdatePending } = useMutationReferenceSettings({
    category,
    currentReferenceSetting: data,
    onSuccess: () => {
      invalidateReferenceSettings()
      toast.success(t('api.actionSuccess', { ns: 'common' }))
    },
  })

  return {
    referenceSetting: data,
    setReferenceSettings: updateReferenceSetting,
    canManagement: permissionAccess.canManagement,
    canDebugger: permissionAccess.canDebugger,
    canInstallPlugin: permissionAccess.canInstallPlugin,
    canUpdatePlugin: permissionAccess.canUpdatePlugin,
    canDeletePlugin: permissionAccess.canDeletePlugin,
    canDebugPlugin: permissionAccess.canDebugPlugin,
    canSetPermissions: permissionAccess.canSetPermissions,
    canSetPluginPreferences: permissionAccess.canSetPluginPreferences,
    currentDifyVersion: permissionAccess.currentDifyVersion,
    isPermissionLoading: permissionAccess.isPermissionLoading,
    permissionError: permissionAccess.permissionError,
    isReferenceSettingLoading: autoUpgradeQuery.isLoading || autoUpgradeQuery.isFetching,
    referenceSettingError: autoUpgradeQuery.error,
    isUpdatePending,
  }
}

export const useCanInstallPluginFromMarketplace = () => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const marketplaceAccess = systemFeatures.enable_marketplace
  const rbacEnabled = systemFeatures.rbac_enabled
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner, workspacePermissionKeys } = useAppContext()
  const permissionQuery = usePluginPermissionSettings()
  const { data: permissions } = permissionQuery
  const legacyCanInstallPlugin = hasLegacyPluginPermissionAccess({
    isAdminOrOwner: isCurrentWorkspaceManager || isCurrentWorkspaceOwner,
    permission: permissions?.install_permission,
    rbacEnabled,
  })
  const canInstallPlugin = hasPermission(workspacePermissionKeys, 'plugin.install') && legacyCanInstallPlugin

  const canInstallPluginFromMarketplace = useMemo(() => {
    return Boolean(marketplaceAccess && canInstallPlugin)
  }, [marketplaceAccess, canInstallPlugin])

  return {
    canInstallPluginFromMarketplace,
  }
}

export default useReferenceSetting
