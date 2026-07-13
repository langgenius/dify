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
  } finally {
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
  } finally {
    await ctx.dispose()
  }
}

export async function agentBuildDraftExists(agentId: string): Promise<boolean> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/build-draft`)
    if (response.status() === 404) return false

    await expectApiResponseOK(response, `Get Agent v2 build draft for ${agentId}`)
    return true
  } finally {
    await ctx.dispose()
  }
}

export async function getAgentBuildDraft(agentId: string): Promise<AgentBuildDraftResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/build-draft`)
    await expectApiResponseOK(response, `Get Agent v2 build draft for ${agentId}`)
    return (await response.json()) as AgentBuildDraftResponse
  } finally {
    await ctx.dispose()
  }
}

export async function applyAgentBuildDraft(agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/build-draft/apply`)
    await expectApiResponseOK(response, `Apply Agent v2 build draft for ${agentId}`)
  } finally {
    await ctx.dispose()
  }
}

export async function discardAgentBuildDraft(agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/build-draft`)
    await expectApiResponseOK(response, `Discard Agent v2 build draft for ${agentId}`)
  } finally {
    await ctx.dispose()
  }
}
