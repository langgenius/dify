import type { SelectorKey } from 'i18next'
import type { AccessPolicyResourceType } from '@/models/access-control'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useAppPermissionCatalog,
  useDatasetPermissionCatalog,
} from '@/service/access-control/use-permission-catalog'

export const usePermissionsGroups = (resourceType: AccessPolicyResourceType) => {
  const { t } = useTranslation()
  const { data: appPermissionCatalog } = useAppPermissionCatalog(resourceType === 'app')
  const { data: datasetPermissionCatalog } = useDatasetPermissionCatalog(resourceType === 'dataset')

  const permissionCatalog = resourceType === 'app' ? appPermissionCatalog : datasetPermissionCatalog

  const groups = useMemo(() => {
    // Permission keys come from the catalog API, so this is a reviewed open-key boundary with a server-provided fallback.
    const translatePermissionName = (key: string, defaultValue: string) =>
      t(key as SelectorKey, {
        ns: 'permissionKeys',
        defaultValue,
      })

    return (permissionCatalog?.groups || []).map((group) => ({
      ...group,
      group_name: t(($) => $[`group.${resourceType}_acl`], {
        ns: 'permission',
        defaultValue: group.group_name,
      }),
      permissions: group.permissions.map((permission) => ({
        ...permission,
        name: translatePermissionName(permission.key, permission.name),
      })),
    }))
  }, [permissionCatalog?.groups, resourceType, t])

  const allPermissions = groups.flatMap((g) => g.permissions) || []

  const permissionMap = Object.fromEntries(allPermissions.map((p) => [p.key, p]))

  return {
    groups,
    permissionMap,
  }
}
