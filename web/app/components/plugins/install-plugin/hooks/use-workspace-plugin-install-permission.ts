import { useMemo } from 'react'
import { useAppContext } from '@/context/app-context'
import { hasPermission } from '@/utils/permission'

const pluginInstallPermissionKeys = ['plugin.install', 'plugin.manage']

const useWorkspacePluginInstallPermission = () => {
  const { langGeniusVersionInfo, workspacePermissionKeys } = useAppContext()

  const canInstallPlugin = useMemo(() => {
    return hasPermission(workspacePermissionKeys, pluginInstallPermissionKeys)
  }, [workspacePermissionKeys])

  return {
    canInstallPlugin,
    currentDifyVersion: langGeniusVersionInfo?.current_version,
  }
}

export default useWorkspacePluginInstallPermission
