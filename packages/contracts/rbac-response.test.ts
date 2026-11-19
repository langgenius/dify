import { describe, expect, it } from 'vite-plus/test'
import {
  zDeleteWorkspacesCurrentRbacAccessPoliciesByPolicyIdResponse,
  zDeleteWorkspacesCurrentRbacAgentsByAgentIdAccessPoliciesByPolicyIdMemberBindingsResponse,
  zDeleteWorkspacesCurrentRbacAppsByAppIdAccessPoliciesByPolicyIdMemberBindingsResponse,
  zDeleteWorkspacesCurrentRbacDatasetsByDatasetIdAccessPoliciesByPolicyIdMemberBindingsResponse,
  zDeleteWorkspacesCurrentRbacRolesByRoleIdResponse,
} from './generated/api/console/workspaces/zod.gen.ts'

describe('generated RBAC delete responses', () => {
  it.each([
    ['role', zDeleteWorkspacesCurrentRbacRolesByRoleIdResponse],
    ['policy', zDeleteWorkspacesCurrentRbacAccessPoliciesByPolicyIdResponse],
    [
      'agent member binding',
      zDeleteWorkspacesCurrentRbacAgentsByAgentIdAccessPoliciesByPolicyIdMemberBindingsResponse,
    ],
    [
      'app member binding',
      zDeleteWorkspacesCurrentRbacAppsByAppIdAccessPoliciesByPolicyIdMemberBindingsResponse,
    ],
    [
      'dataset member binding',
      zDeleteWorkspacesCurrentRbacDatasetsByDatasetIdAccessPoliciesByPolicyIdMemberBindingsResponse,
    ],
  ])('validates the %s success payload', (_name, response) => {
    expect(response.parse({ result: 'success' })).toEqual({ result: 'success' })
    expect(response.safeParse({}).success).toBe(false)
  })
})
