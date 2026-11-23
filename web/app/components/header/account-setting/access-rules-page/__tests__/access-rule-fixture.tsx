import type { AccessPolicyResourceType } from '@/models/access-control'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createAccessPolicyFixture } from '@/test/fixtures/access-policy'
import { ResourceAccessRuleSection } from '../resource-access-rule-section'

export const resources = ['app', 'dataset', 'agent'] as const
export const permissionFor = (type: AccessPolicyResourceType) =>
  type === 'app' ? 'app.acl.release_and_version' : `${type}.acl.edit`
// Access policy routes take UUID path parameters.
const ruleIds: Record<AccessPolicyResourceType, string> = {
  app: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  dataset: '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e',
  agent: '2c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f',
}
export function ruleFor(type: AccessPolicyResourceType, name = `${type} rule`) {
  return {
    policy: createAccessPolicyFixture({
      id: ruleIds[type],
      resource_type: type,
      name,
      permission_keys: [permissionFor(type)],
    }),
    accounts: [],
    roles: [],
  }
}
export function rulePage(
  items: ReturnType<typeof ruleFor>[],
  page = 1,
  totalPages = 1,
  totalCount = items.length,
) {
  return {
    items,
    pagination: {
      current_page: page,
      total_pages: totalPages,
      total_count: totalCount,
      per_page: 20,
    },
  }
}
export async function renderAccessRule(type: AccessPolicyResourceType, canManage = true) {
  const { queryClient, wrapper: Providers } = createConsoleQueryWrapper({
    workspacePermissionKeys: canManage ? ['workspace.role.manage'] : [],
  })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.rbac.rolePermissions.catalog[type].get.queryKey({ input: {} }),
    {
      groups: [
        {
          group_key: `${type}_acl`,
          group_name: type,
          description: '',
          permissions: [{ key: permissionFor(type), name: 'Edit configuration', description: '' }],
        },
      ],
    },
  )
  const screen = await render(
    <Providers>
      <ResourceAccessRuleSection resourceType={type} />
    </Providers>,
  )
  return { screen, queryClient }
}
