import { useMemo } from 'react'
import { useAppContext } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'

const useWorkspacePluginInstallPermission = () => {
  const {
    langGeniusVersionInfo,
    workspacePermissionKeys,
  } = useAppContext()

  const canInstallPlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.install')
  }, [workspacePermissionKeys])

  const canUpdatePlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.install')
  }, [workspacePermissionKeys])

  const canDeletePlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, 'plugin.delete')
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
    canDeletePlugin,
    canDebugPlugin,
    canSetPluginPreferences,
    currentDifyVersion: langGeniusVersionInfo?.current_version,
  }
}

export default useWorkspacePluginInstallPermission
