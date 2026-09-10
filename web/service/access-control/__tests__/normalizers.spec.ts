import type { ResourceUserAccessPoliciesResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { normalizeAppUserAccessPolicies, normalizeDatasetUserAccessPolicies } from '../normalizers'

const createResourceUserAccessPoliciesResponse = (
  overrides: Partial<ResourceUserAccessPoliciesResponse> = {},
): ResourceUserAccessPoliciesResponse => ({
  data: [],
  ...overrides,
})

describe('access-control normalizers', () => {
  describe('Resource user access policies', () => {
    it('should preserve pagination metadata', () => {
      const response = createResourceUserAccessPoliciesResponse({
        pagination: {
          current_page: 2,
          per_page: 20,
          total_count: 45,
          total_pages: 3,
        },
      })
      const result = normalizeAppUserAccessPolicies(response)

      expect(result.pagination).toEqual({
        current_page: 2,
        per_page: 20,
        total_count: 45,
        total_pages: 3,
      })
    })

    it.each([
      ['app', normalizeAppUserAccessPolicies],
      ['dataset', normalizeDatasetUserAccessPolicies],
    ] as const)('should preserve the workspace owner role tag for %s access', (_, normalize) => {
      const response = createResourceUserAccessPoliciesResponse({
        data: [
          {
            account: {
              account_id: 'owner-account',
              account_name: 'Workspace Owner',
            },
            roles: [
              {
                id: 'owner-role',
                type: 'workspace',
                category: 'global_system_default',
                name: 'Owner',
                is_builtin: true,
                permission_keys: [],
                role_tag: 'owner',
              },
            ],
            access_policies: [],
          },
        ],
      })

      expect(normalize(response).data[0]?.roles[0]?.role_tag).toBe('owner')
    })
  })
})
