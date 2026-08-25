import type { ResourceUserAccessPoliciesResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import { normalizeAppUserAccessPolicies } from '../normalizers'

const createResourceUserAccessPoliciesResponse = (
  overrides: Partial<ResourceUserAccessPoliciesResponse> = {},
): ResourceUserAccessPoliciesResponse => ({
  data: [],
  scope: 'specific',
  ...overrides,
})

describe('access-control normalizers', () => {
  // Resource access scope values come from the RBAC whitelist enum and must not be collapsed.
  describe('Resource user access policies', () => {
    it('should preserve only-me open scope when normalizing app user access policies', () => {
      const response = createResourceUserAccessPoliciesResponse({
        scope: 'only_me',
      })

      expect(normalizeAppUserAccessPolicies(response).scope).toBe('only_me')
    })
  })
})
