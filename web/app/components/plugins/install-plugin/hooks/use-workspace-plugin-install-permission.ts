import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useAppContext } from '@/context/app-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePluginPermissionSettings } from '@/service/use-plugins'
import { hasPermission } from '@/utils/permission'
import { hasLegacyPluginPermissionAccess } from '../../plugin-permissions'

const pluginReadAndUpdatePermissionKeys = ['plugin.install', 'plugin.manage']

const useWorkspacePluginInstallPermission = () => {
  const {
    isCurrentWorkspaceManager,
    isCurrentWorkspaceOwner,
    langGeniusVersionInfo,
    workspacePermissionKeys,
  } = useAppContext()
  const { data: rbacEnabled } = useQuery({
    ...systemFeaturesQueryOptions(),
    select: s => s.rbac_enabled,
  })
  const permissionQuery = usePluginPermissionSettings()
  const { data: permissions } = permissionQuery
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

  const canInstallPlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.install') && legacyCanInstallPlugin
  }, [legacyCanInstallPlugin, workspacePermissionKeys])

  const canUpdatePlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, pluginReadAndUpdatePermissionKeys) && legacyCanInstallPlugin
  }, [legacyCanInstallPlugin, workspacePermissionKeys])

  const canViewInstalledPlugins = useMemo(() => {
    return hasPermission(workspacePermissionKeys, pluginReadAndUpdatePermissionKeys)
  }, [workspacePermissionKeys])

  const canManagePlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.manage') && legacyCanInstallPlugin
  }, [legacyCanInstallPlugin, workspacePermissionKeys])

  const canDebugPlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.debug') && legacyCanDebugPlugin
  }, [legacyCanDebugPlugin, workspacePermissionKeys])

  const canSetPluginPreferences = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.plugin_preferences')
  }, [workspacePermissionKeys])

  return {
    canInstallPlugin,
    canUpdatePlugin,
    canViewInstalledPlugins,
    canManagePlugin,
    canDebugPlugin,
    canSetPluginPreferences,
    currentDifyVersion: langGeniusVersionInfo?.current_version,
  }
}

export default useWorkspacePluginInstallPermission
