import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { zAgentAppDetailWithSite } from '@dify/contracts/api/console/agent/zod.gen'
import { AgentPermission } from '@/features/agent-v2/acl'

export function createAgentFixture(overrides: Partial<AgentAppDetailWithSite> = {}) {
  return zAgentAppDetailWithSite.parse({
    id: 'agent-1',
    app_id: 'app-1',
    name: 'Agent',
    mode: 'agent',
    icon_url: null,
    enable_api: true,
    enable_site: true,
    permission_keys: Object.values(AgentPermission).filter((key) => key !== AgentPermission.Create),
    ...overrides,
  })
}
