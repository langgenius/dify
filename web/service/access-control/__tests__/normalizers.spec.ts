import type { ResourceUserAccessPoliciesResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { normalizeAppUserAccessPolicies } from '../normalizers'

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
  })
})
