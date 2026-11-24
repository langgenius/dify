import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { Role } from '@/models/access-control'
import { createRef } from 'react'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { TEST_ROLE_ID, TEST_WORKSPACE_ID } from '@/test/console/ids'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import PermissionsPage from '../index'

export const customRole: Role = {
  id: TEST_ROLE_ID,
  tenant_id: TEST_WORKSPACE_ID,
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
  id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
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
export async function renderRolePage({
  canManage = true,
  deploymentEdition = 'ENTERPRISE',
}: { canManage?: boolean; deploymentEdition?: DeploymentEdition } = {}) {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: deploymentEdition, rbac_enabled: true },
    workspacePermissionKeys: canManage ? ['workspace.role.manage'] : [],
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog.get.queryKey({ input: {} }),
    {
      groups: [
        {
          group_key: 'workspace',
          group_name: 'Workspace',
          description: '',
          permissions: [
            { key: 'workspace.member.manage', name: 'Manage members', description: '' },
            { key: 'ip_policy.view', name: 'View IP Policies', description: '' },
            {
              key: 'ip_policy.manage',
              name: 'Create, Edit and Delete IP Policies',
              description: '',
            },
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
