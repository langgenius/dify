import type { SelectorKey } from 'i18next'
import type { PermissionGroupListLoadError } from '../../permission-group-list'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { isWorkspacePermissionVisible } from '../../workspace-permission-visibility'

export const useWorkspacePermissionGroups = () => {
  const { t } = useTranslation(['permission', 'permissionKeys'])
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const workspacePermissionCatalogQuery = useQuery(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryOptions({
      input: {},
    }),
  )
  const workspacePermissionCatalog = workspacePermissionCatalogQuery.data

  const groups = useMemo(() => {
    // Permission keys come from the catalog API, so these are reviewed open-key boundaries with server-provided fallbacks.
    const translatePermissionGroupName = (groupKey: string, defaultValue: string) =>
      t(`group.${groupKey}` as SelectorKey, {
        ns: 'permission',
        defaultValue,
      })
    const translatePermissionName = (key: string, defaultValue: string) =>
      t(key as SelectorKey, {
        ns: 'permissionKeys',
        defaultValue,
      })

    return (workspacePermissionCatalog?.groups ?? [])
      .map((group) => ({
        ...group,
        group_name: translatePermissionGroupName(group.group_key, group.group_name),
        permissions: (group.permissions ?? [])
          .filter(({ key }) => isWorkspacePermissionVisible(key, deploymentEdition))
          .map((permission) => ({
            ...permission,
            name: translatePermissionName(permission.key, permission.name),
          })),
      }))
      .filter((group) => group.permissions.length > 0)
  }, [deploymentEdition, t, workspacePermissionCatalog?.groups])

  const allPermissions = groups.flatMap((g) => g.permissions)

  const permissionMap = Object.fromEntries(allPermissions.map((p) => [p.key, p]))

  // Every caller renders the failed first load; a failed refetch keeps the catalog and toasts.
  const catalogLoad = useOwnedQueryError(workspacePermissionCatalogQuery)
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
