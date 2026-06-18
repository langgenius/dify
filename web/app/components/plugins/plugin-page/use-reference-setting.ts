import type { PluginCategoryEnum } from '../types'
import { toast } from '@langgenius/dify-ui/toast'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { hasPluginPermission, useInvalidateReferenceSettings, useMutationPluginPermissionSettings, useMutationReferenceSettings, usePluginAutoUpgradeSettings, usePluginPermissionSettings } from '@/service/use-plugins'
import { hasPermission } from '@/utils/permission'

const pluginReadAndUpdatePermissionKeys = ['plugin.install', 'plugin.manage']

export const useCanSetPluginSettings = () => {
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner, workspacePermissionKeys } = useAppContext()
  const { data: rbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.rbac_enabled,
  })
  const isWorkspaceAdmin = isCurrentWorkspaceManager || isCurrentWorkspaceOwner

  return {
    canSetPermissions: !rbacEnabled && isWorkspaceAdmin,
    canSetPluginPreferences: rbacEnabled
      ? hasPermission(workspacePermissionKeys, 'plugin.plugin_preferences')
      : isWorkspaceAdmin,
  }
}

export const usePluginSettingsAccess = () => {
  const { t } = useTranslation()
  const { workspacePermissionKeys, langGeniusVersionInfo } = useAppContext()
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
  const legacyCanInstallPlugin = hasPluginPermission(permissions?.install_permission, canSetPermissions)
  const legacyCanDebugPlugin = hasPluginPermission(permissions?.debug_permission, canSetPermissions)
  const canInstallPlugin = rbacEnabled
    ? hasPermission(workspacePermissionKeys, 'plugin.install')
    : legacyCanInstallPlugin
  const canUpdatePlugin = rbacEnabled
    ? hasPermission(workspacePermissionKeys, pluginReadAndUpdatePermissionKeys)
    : true
  const canViewInstalledPlugins = rbacEnabled
    ? hasPermission(workspacePermissionKeys, pluginReadAndUpdatePermissionKeys)
    : true
  const canManagePlugin = rbacEnabled
    ? hasPermission(workspacePermissionKeys, 'plugin.manage')
    : true
  const canDebugPlugin = rbacEnabled
    ? hasPermission(workspacePermissionKeys, 'plugin.debug')
    : legacyCanDebugPlugin

  return {
    permission: permissions,
    setPluginPermissionSettings,
    canInstallPlugin,
    canUpdatePlugin,
    canViewInstalledPlugins,
    canManagePlugin,
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
    canViewInstalledPlugins: permissionAccess.canViewInstalledPlugins,
    canManagePlugin: permissionAccess.canManagePlugin,
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
  const { data: marketplaceAccess } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: s => ({
      enableMarketplace: s.enable_marketplace,
      rbacEnabled: s.rbac_enabled,
    }),
  })
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner, workspacePermissionKeys } = useAppContext()
  const { data: permissions } = usePluginPermissionSettings()
  const legacyCanInstallPlugin = hasPluginPermission(
    permissions?.install_permission,
    isCurrentWorkspaceManager || isCurrentWorkspaceOwner,
  )
  const canInstallPlugin = marketplaceAccess.rbacEnabled
    ? hasPermission(workspacePermissionKeys, 'plugin.install')
    : legacyCanInstallPlugin

  const canInstallPluginFromMarketplace = useMemo(() => {
    return marketplaceAccess.enableMarketplace && canInstallPlugin
  }, [marketplaceAccess.enableMarketplace, canInstallPlugin])

  return {
    canInstallPluginFromMarketplace,
  }
}

export default useReferenceSetting
