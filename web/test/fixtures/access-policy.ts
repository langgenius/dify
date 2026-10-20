import type { AccessPolicy } from '@dify/contracts/api/console/workspaces/types.gen'
import { zAccessPolicy } from '@dify/contracts/api/console/workspaces/zod.gen'

export function createAccessPolicyFixture(overrides: Partial<AccessPolicy> = {}) {
  return zAccessPolicy.parse({
    id: 'policy-1',
    tenant_id: 'tenant-1',
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
