import type { ResourceUserAccessPoliciesResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { normalizeAppUserAccessPolicies, normalizeDatasetUserAccessPolicies } from '../normalizers'

it.each([
  ['app', normalizeAppUserAccessPolicies],
  ['dataset', normalizeDatasetUserAccessPolicies],
] as const)('preserves privileged role tags and pagination for %s access', (_, normalize) => {
  const response: ResourceUserAccessPoliciesResponse = {
    pagination: { current_page: 2, per_page: 20, total_count: 45, total_pages: 3 },
    data: ['owner', 'admin'].map((role) => ({
      account: { account_id: `${role}-account`, account_name: role },
      roles: [
        {
          id: `${role}-role`,
          type: 'workspace',
          category: 'global_system_default',
          name: role,
          is_builtin: true,
          permission_keys: [],
          role_tag: role,
        },
      ],
      access_policies: [],
    })),
  }
  const result = normalize(response)
  expect(result.pagination).toEqual(response.pagination)
  expect(
    result.data.map((item) => ({ id: item.account.account_id, tag: item.roles[0]?.role_tag })),
  ).toEqual([
    { id: 'owner-account', tag: 'owner' },
    { id: 'admin-account', tag: 'admin' },
  ])
})
