import type { RbacRole } from '@dify/contracts/api/console/workspaces/types.gen'

export const isWorkspaceAdminRole = (role: RbacRole): boolean => {
  if (role.type !== 'workspace') return false

  return (
    role.role_tag === 'admin' ||
    (role.is_builtin === true &&
      role.category === 'global_system_default' &&
      role.name.toLowerCase() === 'admin')
  )
}
