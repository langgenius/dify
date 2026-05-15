import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspacePermissionCatalog } from '@/service/access-control/use-permission-catalog'

export const useWorkspacePermissionGroups = () => {
  const { t } = useTranslation()
  const { data: workspacePermissionCatalog } = useWorkspacePermissionCatalog()

  const groups = useMemo(() => {
    return (workspacePermissionCatalog?.groups || []).map(group => ({
      ...group,
      group_name: t(`group.${group.group_key}`, {
        ns: 'permission',
        defaultValue: group.group_name,
      }),
      permissions: group.permissions.map(permission => ({
        ...permission,
        name: t(permission.key, {
          ns: 'permissionKeys',
          defaultValue: permission.name,
        }),
      })),
    }))
  }, [t, workspacePermissionCatalog?.groups])

  const allPermissions = groups.flatMap(g => g.permissions) || []

  const permissionMap = Object.fromEntries(
    allPermissions.map(p => [p.key, p]),
  )

  return {
    groups,
    permissionMap,
  }
}
