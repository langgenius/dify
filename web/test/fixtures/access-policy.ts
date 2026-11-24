import type { AccessPolicy } from '@dify/contracts/api/console/workspaces/types.gen'
import { zAccessPolicy } from '@dify/contracts/api/console/workspaces/zod.gen'
import { TEST_ACCESS_POLICY_ID, TEST_WORKSPACE_ID } from '@/test/console/ids'

export function createAccessPolicyFixture(overrides: Partial<AccessPolicy> = {}) {
  return zAccessPolicy.parse({
    id: TEST_ACCESS_POLICY_ID,
    tenant_id: TEST_WORKSPACE_ID,
    resource_type: 'agent',
    policy_key: 'custom-agent-policy',
    name: 'Agent editors',
    description: 'Edit Agent configuration',
    permission_keys: ['agent.acl.edit'],
    is_builtin: false,
    category: 'global_custom',
    created_at: 1,
    updated_at: 1,
    ...overrides,
  })
}
