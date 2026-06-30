import type { InfiniteData } from '@tanstack/react-query'
import type { RoleListGroup } from './role-list'
import type { RoleListResponse } from '@/models/access-control'

export const formatRoleGroups = (roleListResponse: InfiniteData<RoleListResponse> | undefined): RoleListGroup[] => {
  if (!roleListResponse)
    return []
  const roles = roleListResponse.pages.flatMap(page => page.data)
  const result: RoleListGroup[] = []
  const builtinRoles = roles.filter(role => role.is_builtin)
  const customRoles = roles.filter(role => !role.is_builtin)
  if (builtinRoles.length > 0) {
    result.push({
      id: 'builtin',
      category: 'global_system_default',
      title: 'System Roles',
      items: builtinRoles,
    })
  }
  if (customRoles.length > 0) {
    result.push({
      id: 'custom',
      category: 'global_custom',
      title: 'Custom Roles',
      items: customRoles,
    })
  }
  return result
}
