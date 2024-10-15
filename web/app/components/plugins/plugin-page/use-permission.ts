import { useEffect } from 'react'
import { PermissionType } from '../types'
import {
  usePluginPageContext,
} from './context'
import { useAppContext } from '@/context/app-context'

const hasPermission = (permission: PermissionType, isAdmin: boolean) => {
  if (permission === PermissionType.noOne)
    return false

  if (permission === PermissionType.everyone)
    return true

  return isAdmin
}

const usePermission = () => {
  const { isCurrentWorkspaceManager, isCurrentWorkspaceOwner } = useAppContext()
  const [permissions, setPermissions] = usePluginPageContext(v => [v.permissions, v.setPermissions])
  const isAdmin = isCurrentWorkspaceManager || isCurrentWorkspaceOwner

  useEffect(() => {
    // TODO: fetch permissions from server
    setPermissions({
      canInstall: PermissionType.everyone,
      canDebugger: PermissionType.everyone,
    })
  }, [])
  return {
    canInstall: hasPermission(permissions.canInstall, isAdmin),
    canDebugger: hasPermission(permissions.canDebugger, isAdmin),
    canSetPermissions: isAdmin,
    permissions,
    setPermissions,
  }
}

export default usePermission
