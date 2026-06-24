import { useMemo } from 'react'
import { useAppContext } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'

const pluginReadAndUpdatePermissionKeys = ['plugin.install', 'plugin.manage']

const useWorkspacePluginInstallPermission = () => {
  const {
    langGeniusVersionInfo,
    workspacePermissionKeys,
  } = useAppContext()

  const canInstallPlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.install')
  }, [workspacePermissionKeys])

  const canUpdatePlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, pluginReadAndUpdatePermissionKeys)
  }, [workspacePermissionKeys])

  const canViewInstalledPlugins = useMemo(() => {
    return hasPermission(workspacePermissionKeys, pluginReadAndUpdatePermissionKeys)
  }, [workspacePermissionKeys])

  const canManagePlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.manage')
  }, [workspacePermissionKeys])

  const canDebugPlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.debug')
  }, [workspacePermissionKeys])

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
