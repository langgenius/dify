import type {
  AgentAppComposerResponse,
  AgentAppCreatePayload,
  AgentAppDetailWithSite,
  AgentReferencingWorkflowResponse,
  AgentReferencingWorkflowsResponse,
  AgentSoulConfig,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ConsoleClient } from '../../../support/api/console-client'
import { assertE2EResourceName, createE2EResourceName } from '../../../support/naming'
import {
  createPublishableAgentSoulConfig,
  defaultAgentSoulConfig,
  normalAgentSoulConfig,
} from './agent-soul'

export type CreateTestAgentOptions = {
  description?: string
  name?: string
  role?: string
}

export const getAgentConfigurePath = (agentId: string) => `/agents/${agentId}/configure`
export const getAgentAccessPath = (agentId: string) => `/agents/${agentId}/access`

export async function createTestAgent(
  client: ConsoleClient,
  {
    description = 'Created by Dify E2E.',
    name = createE2EResourceName('Agent'),
    role = 'E2E test assistant',
  }: CreateTestAgentOptions = {},
): Promise<AgentAppDetailWithSite> {
  assertE2EResourceName(name, 'Agent')
  const body = {
    description,
    icon: '🤖',
    icon_background: '#FFEAD5',
    icon_type: 'emoji',
    name,
    role,
  } satisfies AgentAppCreatePayload

  return client.agent.post({ body })
}

export async function createConfiguredTestAgent(
  client: ConsoleClient,
  {
    agentSoul = normalAgentSoulConfig,
    seed,
  }: {
    agentSoul?: AgentSoulConfig
    seed?: CreateTestAgentOptions
  } = {},
): Promise<AgentAppDetailWithSite> {
  const agent = await createTestAgent(client, seed)
  await saveAgentComposerDraft(client, agent.id, agentSoul)
  return agent
}

export async function saveAgentComposerDraft(
  client: ConsoleClient,
  agentId: string,
  agentSoul: AgentSoulConfig = defaultAgentSoulConfig,
): Promise<AgentAppComposerResponse> {
  return client.agent.byAgentId.composer.put({
    body: {
      agent_soul: agentSoul,
      save_strategy: 'save_to_current_version',
      variant: 'agent_app',
    },
    params: { agent_id: agentId },
  })
}

export async function getAgentReferencingWorkflows(
  client: ConsoleClient,
  agentId: string,
): Promise<AgentReferencingWorkflowResponse[]> {
  const body: AgentReferencingWorkflowsResponse =
    await client.agent.byAgentId.referencingWorkflows.get({ params: { agent_id: agentId } })
  return body.data ?? []
}

async function ensureAgentComposerDraftIsPublishable(
  client: ConsoleClient,
  agentId: string,
): Promise<void> {
  const composer = await client.agent.byAgentId.composer.get({ params: { agent_id: agentId } })
  if (!composer.agent_soul?.model)
    await saveAgentComposerDraft(
      client,
      agentId,
      createPublishableAgentSoulConfig(composer.agent_soul ?? defaultAgentSoulConfig),
    )
}

export async function publishAgentWithPublishableDraft(
  client: ConsoleClient,
  agentId: string,
  versionNote = 'E2E publish',
): Promise<void> {
  await ensureAgentComposerDraftIsPublishable(client, agentId)
  await client.agent.byAgentId.publish.post({
    body: { version_note: versionNote },
    params: { agent_id: agentId },
  })
}
