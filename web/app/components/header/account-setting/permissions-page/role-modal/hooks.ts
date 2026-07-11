import type { SelectorKey } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspacePermissionCatalog } from '@/service/access-control/use-permission-catalog'

export const useWorkspacePermissionGroups = () => {
  const { t } = useTranslation()
  const { data: workspacePermissionCatalog } = useWorkspacePermissionCatalog()

  const groups = useMemo(() => {
    // Permission keys come from the catalog API, so these are reviewed open-key boundaries with server-provided fallbacks.
    const translatePermissionGroupName = (groupKey: string, defaultValue: string) => t(`group.${groupKey}` as SelectorKey, {
      ns: 'permission',
      defaultValue,
    })
    const translatePermissionName = (key: string, defaultValue: string) => t(key as SelectorKey, {
      ns: 'permissionKeys',
      defaultValue,
    })

    return (workspacePermissionCatalog?.groups || []).map(group => ({
      ...group,
      group_name: translatePermissionGroupName(group.group_key, group.group_name),
      permissions: group.permissions.map(permission => ({
        ...permission,
        name: translatePermissionName(permission.key, permission.name),
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
