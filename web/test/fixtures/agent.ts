import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import { zAgentAppDetailWithSite } from '@dify/contracts/api/console/agent/zod.gen'
import { AgentPermission } from '@/features/agent-v2/acl'
import { TEST_AGENT_ID, TEST_APP_ID } from '@/test/console/ids'
import { createAppDetailFixture } from './app'

export function createAgentFixture(overrides: Partial<AgentAppDetailWithSite> = {}) {
  return zAgentAppDetailWithSite.parse({
    ...createAppDetailFixture(),
    access_ready: true,
    id: TEST_AGENT_ID,
    app_id: TEST_APP_ID,
    name: 'Agent',
    mode: 'agent',
    icon_url: null,
    enable_api: true,
    enable_site: true,
    permission_keys: Object.values(AgentPermission).filter((key) => key !== AgentPermission.Create),
    ...overrides,
  })
}
