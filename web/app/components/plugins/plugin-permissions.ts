import { PermissionType } from './types'

type LegacyPluginPermissionAccessOptions = {
  isAdminOrOwner: boolean
  permission?: PermissionType
  rbacEnabled?: boolean
}

export const hasLegacyPluginPermissionAccess = ({
  isAdminOrOwner,
  permission,
  rbacEnabled,
}: LegacyPluginPermissionAccessOptions) => {
  if (rbacEnabled !== false)
    return true

  if (!permission)
    return false

  if (permission === PermissionType.everyone)
    return true

  if (permission === PermissionType.admin)
    return isAdminOrOwner

  return false
}
