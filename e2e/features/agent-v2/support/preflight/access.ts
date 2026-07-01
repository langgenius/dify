import type { DifyWorld } from '../../../support/world'
import type { PreseededResource } from './common'
import { createApiContext, expectApiResponseOK } from '../../../../support/api'
import { skipMissingPreseededAgent, skipMissingPreseededWorkflow } from './agents'
import { skipBlockedPrecondition } from './common'

type AgentApiAccessResponse = {
  api_key_count: number
  enabled: boolean
}

type AgentApiKeyListResponse = {
  data: Array<{
    id: string
  }>
}

type AgentReferencingWorkflowsResponse = {
  data: Array<{
    app_id: string
    app_name: string
    node_ids?: string[]
  }>
}

type PreseededAgentDetailResponse = {
  active_config_is_published?: boolean
  enable_site?: boolean
  site?: {
    access_token?: string | null
    app_base_url?: string | null
    code?: string | null
  } | null
}

export async function skipMissingPreseededAgentBackendApiKey(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const accessResponse = await ctx.get(`/console/api/agent/${agent.id}/api-access`)
    await expectApiResponseOK(accessResponse, `Check preseeded Agent API access ${agentName}`)
    const access = (await accessResponse.json()) as AgentApiAccessResponse
    if (!access.enabled || access.api_key_count < 1) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" does not have Backend service API enabled with an API key.`,
      )
    }

    const keyResponse = await ctx.get(`/console/api/agent/${agent.id}/api-keys`)
    await expectApiResponseOK(keyResponse, `Check preseeded Agent API key ${agentName}`)
    const keys = (await keyResponse.json()) as AgentApiKeyListResponse
    const key = keys.data.at(0)
    if (!key) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" Backend service API key list is empty.`,
      )
    }

    return {
      id: key.id,
      kind: 'api-key',
      name: `${agentName} Backend service API key`,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentPublishedWebApp(
  world: DifyWorld,
  agentName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}`)
    await expectApiResponseOK(response, `Check preseeded Agent published Web app ${agentName}`)
    const detail = (await response.json()) as PreseededAgentDetailResponse
    if (detail.active_config_is_published !== true) {
      return skipBlockedPrecondition(world, `Preseeded Agent "${agentName}" is not published.`)
    }

    if (detail.enable_site !== true) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" Web app is not enabled.`,
      )
    }

    const siteToken = detail.site?.access_token ?? detail.site?.code
    if (!siteToken || !detail.site?.app_base_url) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" Web app URL is not available.`,
      )
    }

    return {
      id: agent.id,
      kind: 'agent',
      name: agent.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}

export async function skipMissingPreseededAgentWorkflowReference(
  world: DifyWorld,
  agentName: string,
  workflowName: string,
): Promise<'skipped' | PreseededResource> {
  const agent = await skipMissingPreseededAgent(world, agentName)
  if (agent === 'skipped')
    return agent

  const workflow = await skipMissingPreseededWorkflow(world, workflowName)
  if (workflow === 'skipped')
    return workflow

  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agent.id}/referencing-workflows`)
    await expectApiResponseOK(response, `Check preseeded Agent workflow reference ${agentName}`)
    const references = (await response.json()) as AgentReferencingWorkflowsResponse
    const reference = references.data.find(
      item => item.app_id === workflow.id || item.app_name === workflow.name,
    )

    if (!reference) {
      return skipBlockedPrecondition(
        world,
        `Preseeded Agent "${agentName}" is not referenced by workflow "${workflowName}".`,
      )
    }

    if (!reference.node_ids || reference.node_ids.length < 1) {
      return skipBlockedPrecondition(
        world,
        `Preseeded workflow "${workflowName}" does not expose Agent reference nodes for "${agentName}".`,
      )
    }

    return {
      id: workflow.id,
      kind: 'workflow',
      name: workflow.name,
    }
  }
  finally {
    await ctx.dispose()
  }
}
