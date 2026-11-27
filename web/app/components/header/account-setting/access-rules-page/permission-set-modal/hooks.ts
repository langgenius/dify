import type { SelectorKey } from 'i18next'
import type { PermissionGroupListLoadError } from '../../permission-group-list'
import type { AccessPolicyResourceType } from '@/models/access-control'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'

export const usePermissionsGroups = (resourceType: AccessPolicyResourceType) => {
  const { t } = useTranslation(['permission', 'permissionKeys'])
  const permissionCatalogQueryOptions =
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog[resourceType].get.queryOptions({
      input: {},
    })
  const permissionCatalogQuery = useQuery(permissionCatalogQueryOptions)
  const permissionCatalog = permissionCatalogQuery.data

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

  // Every caller renders the failed first load; a failed refetch keeps the catalog and toasts.
  const catalogLoad = useOwnedQueryError(permissionCatalogQuery)
  const loadError: PermissionGroupListLoadError | undefined = catalogLoad && {
    error: catalogLoad.error,
    retrying: catalogLoad.retrying,
    onRetry: catalogLoad.retry,
  }

  return {
    groups,
    loadError,
    permissionMap,
  }
}
