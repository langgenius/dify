import type { Role } from '@/models/access-control'
import { createRef } from 'react'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import PermissionsPage from '../index'

export const customRole: Role = {
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Custom manager',
  description: 'Can manage workspace members',
  is_builtin: false,
  permission_keys: ['workspace.member.manage'],
  role_tag: '',
}
export const builtinRole: Role = {
  ...customRole,
  id: 'owner',
  category: 'global_system_default',
  name: 'Owner',
  description: 'Workspace owner',
  is_builtin: true,
  role_tag: 'owner',
}
export function rolePage(roles: Role[]) {
  return {
    data: roles,
    pagination: { current_page: 1, total_pages: 1, total_count: roles.length, per_page: 20 },
  }
}
export async function renderRolePage(canManage = true) {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: canManage ? ['workspace.role.manage'] : [],
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryKey({ input: {} }),
    {
      groups: [
        {
          group_key: 'workspace_management',
          group_name: 'Workspace management',
          description: '',
          permissions: [
            { key: 'workspace.member.manage', name: 'Manage members', description: '' },
          ],
        },
      ],
    },
  )
  const containerRef = createRef<HTMLDivElement>()
  const screen = await render(
    <Providers>
      <div ref={containerRef} style={{ height: 600, overflowY: 'auto' }}>
        <PermissionsPage containerRef={containerRef} />
      </div>
    </Providers>,
  )
  return { screen, queryClient }
}
