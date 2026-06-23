import type { AccessPolicyResourceType } from '@/models/access-control'
import { useMemo } from 'react'
import { useTranslation } from '#i18n'
import { useAppPermissionCatalog, useDatasetPermissionCatalog } from '@/service/access-control/use-permission-catalog'

export const usePermissionsGroups = (resourceType: AccessPolicyResourceType) => {
  const { t } = useTranslation()
  const { data: appPermissionCatalog } = useAppPermissionCatalog(resourceType === 'app')
  const { data: datasetPermissionCatalog } = useDatasetPermissionCatalog(resourceType === 'dataset')

  const permissionCatalog = resourceType === 'app' ? appPermissionCatalog : datasetPermissionCatalog

  const groups = useMemo(() => {
    return (permissionCatalog?.groups || []).map(group => ({
      ...group,
      group_name: t(`group.${resourceType}_acl`, {
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
  }, [permissionCatalog?.groups, resourceType, t])

  const allPermissions = groups.flatMap(g => g.permissions) || []

  const permissionMap = Object.fromEntries(
    allPermissions.map(p => [p.key, p]),
  )

  return {
    groups,
    permissionMap,
  }
}
