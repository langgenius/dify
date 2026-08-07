import type { SelectorKey } from 'i18next'
import type { AccessPolicyResourceType } from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'

export const usePermissionsGroups = (resourceType: AccessPolicyResourceType) => {
  const { t } = useTranslation()
  const permissionCatalogQueryOptions =
    resourceType === 'app'
      ? consoleQuery.workspaces.current.rbac.rolePermissions.catalog.app.get.queryOptions({
          input: {},
        })
      : consoleQuery.workspaces.current.rbac.rolePermissions.catalog.dataset.get.queryOptions({
          input: {},
        })
  const { data: permissionCatalog } = useQuery(permissionCatalogQueryOptions)

  const groups = useMemo(() => {
    // Permission keys come from the catalog API, so this is a reviewed open-key boundary with a server-provided fallback.
    const translatePermissionName = (key: string, defaultValue: string) =>
      t(key as SelectorKey, {
        ns: 'permissionKeys',
        defaultValue,
      })

    return (permissionCatalog?.groups ?? []).map((group) => ({
      ...group,
      group_name: t(($) => $[`group.${resourceType}_acl`], {
        ns: 'permission',
        defaultValue: group.group_name,
      }),
      permissions: (group.permissions ?? []).map((permission) => ({
        ...permission,
        name: translatePermissionName(permission.key, permission.name),
      })),
    }))
  }, [permissionCatalog?.groups, resourceType, t])

  const allPermissions = groups.flatMap((g) => g.permissions)

  const permissionMap = Object.fromEntries(allPermissions.map((p) => [p.key, p]))

  return {
    groups,
    permissionMap,
  }
}
