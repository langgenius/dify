import type {
  AgentBuildDraftResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { createApiContext, expectApiResponseOK } from '../../../support/api'

export async function checkoutAgentBuildDraft(agentId: string): Promise<AgentBuildDraftResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/build-draft/checkout`, {
      data: { force: true },
    })
    await expectApiResponseOK(response, `Checkout Agent v2 build draft for ${agentId}`)
    return (await response.json()) as AgentBuildDraftResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function saveAgentBuildDraft(
  agentId: string,
  agentSoul: AgentSoulConfig,
): Promise<AgentBuildDraftResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.put(`/console/api/agent/${agentId}/build-draft`, {
      data: {
        agent_soul: agentSoul,
        save_strategy: 'save_to_current_version',
        variant: 'agent_app',
      },
    })
    await expectApiResponseOK(response, `Save Agent v2 build draft for ${agentId}`)
    return (await response.json()) as AgentBuildDraftResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function discardAgentBuildDraft(agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/build-draft`)
    await expectApiResponseOK(response, `Discard Agent v2 build draft for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}
