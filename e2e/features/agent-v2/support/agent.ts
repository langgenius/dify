import type {
  AgentAppComposerResponse,
  AgentAppDetailWithSite,
  AgentConfigSnapshotDetailResponse,
  AgentReferencingWorkflowResponse,
  AgentReferencingWorkflowsResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import { createApiContext, expectApiResponseOK } from '../../../support/api'
import { assertE2EResourceName, createE2EResourceName } from '../../../support/naming'
import {
  createPublishableAgentSoulConfig,
  defaultAgentSoulConfig,
  normalAgentSoulConfig,
} from './agent-soul'

export type AgentSeed = Pick<
  AgentAppDetailWithSite,
  | 'active_config_is_published'
  | 'app_id'
  | 'backing_app_id'
  | 'description'
  | 'enable_site'
  | 'id'
  | 'name'
  | 'role'
  | 'site'
> & {
  active_config_snapshot_id?: string | null
}

export type CreateTestAgentOptions = {
  description?: string
  name?: string
  role?: string
}

export const getAgentConfigurePath = (agentId: string) => `/agents/${agentId}/configure`
export const getAgentAccessPath = (agentId: string) => `/agents/${agentId}/access`

export async function createTestAgent({
  description = 'Created by Dify E2E.',
  name = createE2EResourceName('Agent'),
  role = 'E2E test assistant',
}: CreateTestAgentOptions = {}): Promise<AgentSeed> {
  assertE2EResourceName(name, 'Agent')
  const ctx = await createApiContext()
  try {
    const response = await ctx.post('/console/api/agent', {
      data: {
        description,
        icon: '🤖',
        icon_background: '#FFEAD5',
        icon_type: 'emoji',
        name,
        role,
      },
    })
    await expectApiResponseOK(response, 'Create Agent v2 test agent')
    return (await response.json()) as AgentSeed
  } finally {
    await ctx.dispose()
  }
}

export async function createConfiguredTestAgent({
  agentSoul = normalAgentSoulConfig,
  seed,
}: {
  agentSoul?: AgentSoulConfig
  seed?: CreateTestAgentOptions
} = {}): Promise<AgentSeed> {
  const agent = await createTestAgent(seed)
  await saveAgentComposerDraft(agent.id, agentSoul)
  return agent
}

export async function getTestAgent(agentId: string): Promise<AgentSeed> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}`)
    await expectApiResponseOK(response, `Get Agent v2 test agent ${agentId}`)
    return (await response.json()) as AgentSeed
  } finally {
    await ctx.dispose()
  }
}

export async function getAgentVersionDetail(
  agentId: string,
  versionId: string,
): Promise<AgentConfigSnapshotDetailResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/versions/${versionId}`)
    await expectApiResponseOK(response, `Get Agent v2 version ${versionId} for ${agentId}`)
    return (await response.json()) as AgentConfigSnapshotDetailResponse
  } finally {
    await ctx.dispose()
  }
}

export async function deleteTestAgent(agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}`)
    await expectApiResponseOK(response, `Delete Agent v2 test agent ${agentId}`)
  } finally {
    await ctx.dispose()
  }
}

export async function saveAgentComposerDraft(
  agentId: string,
  agentSoul: AgentSoulConfig = defaultAgentSoulConfig,
): Promise<AgentAppComposerResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.put(`/console/api/agent/${agentId}/composer`, {
      data: {
        agent_soul: agentSoul,
        save_strategy: 'save_to_current_version',
        variant: 'agent_app',
      },
    })
    await expectApiResponseOK(response, `Save Agent v2 composer draft for ${agentId}`)
    return (await response.json()) as AgentAppComposerResponse
  } finally {
    await ctx.dispose()
  }
}

export async function getAgentReferencingWorkflows(
  agentId: string,
): Promise<AgentReferencingWorkflowResponse[]> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/referencing-workflows`)
    await expectApiResponseOK(response, `Get Agent v2 referencing workflows for ${agentId}`)
    const body = (await response.json()) as AgentReferencingWorkflowsResponse
    return body.data ?? []
  } finally {
    await ctx.dispose()
  }
}

export async function getAgentComposerDraft(agentId: string): Promise<AgentAppComposerResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/composer`)
    await expectApiResponseOK(response, `Get Agent v2 composer draft for ${agentId}`)
    return (await response.json()) as AgentAppComposerResponse
  } finally {
    await ctx.dispose()
  }
}

export async function ensureAgentComposerDraftIsPublishable(agentId: string): Promise<void> {
  const composer = await getAgentComposerDraft(agentId)
  if (!composer.agent_soul?.model)
    await saveAgentComposerDraft(
      agentId,
      createPublishableAgentSoulConfig(composer.agent_soul ?? defaultAgentSoulConfig),
    )
}

export async function publishAgent(agentId: string, versionNote = 'E2E publish'): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/publish`, {
      data: { version_note: versionNote },
    })
    await expectApiResponseOK(response, `Publish Agent v2 test agent ${agentId}`)
  } finally {
    await ctx.dispose()
  }
}

export async function publishAgentWithPublishableDraft(
  agentId: string,
  versionNote = 'E2E publish',
): Promise<void> {
  await ensureAgentComposerDraftIsPublishable(agentId)
  await publishAgent(agentId, versionNote)
}
