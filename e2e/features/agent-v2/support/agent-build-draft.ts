import type {
  AgentBuildDraftResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ConsoleClient } from '../../../support/api/console-client'
import { ORPCError } from '@orpc/client'

export async function saveAgentBuildDraft(
  client: ConsoleClient,
  agentId: string,
  agentSoul: AgentSoulConfig,
): Promise<AgentBuildDraftResponse> {
  return client.agent.byAgentId.buildDraft.put({
    body: {
      agent_soul: agentSoul,
      save_strategy: 'save_to_current_version',
      variant: 'agent_app',
    },
    params: { agent_id: agentId },
  })
}

export async function agentBuildDraftExists(
  client: ConsoleClient,
  agentId: string,
): Promise<boolean> {
  try {
    await client.agent.byAgentId.buildDraft.get({ params: { agent_id: agentId } })
    return true
  } catch (error) {
    if (error instanceof ORPCError && error.status === 404) return false
    throw error
  }
}
