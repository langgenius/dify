import { createApiContext, expectApiResponseOK, setAppSiteEnabled } from './api'
import { createE2EResourceName } from './naming'

export type AgentSeed = {
  active_config_is_published?: boolean
  app_id?: string
  backing_app_id?: string
  description?: string
  enable_site?: boolean
  id: string
  name: string
  role?: string
  site?: {
    access_token?: string | null
    app_base_url?: string | null
    code?: string | null
  } | null
}

export type AgentSoulConfig = Record<string, unknown>

export type AgentComposerResponse = {
  agent_soul?: AgentSoulConfig
}

export type AgentBuildDraftResponse = {
  agent_soul: AgentSoulConfig
  draft: Record<string, unknown>
  variant: 'agent_app'
}

export type AgentApiAccess = {
  api_key_count: number
  enabled: boolean
  files_upload_endpoint: string
  service_api_base_url: string
}

export type AgentApiKey = {
  id: string
  token?: string
}

export type CreateTestAgentOptions = {
  description?: string
  name?: string
  role?: string
}

export const defaultAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: 'You are a Dify Agent E2E test assistant.',
  },
}

export const normalAgentPrompt
  = 'You are a Dify Agent E2E test assistant. Reply briefly to every user message, and always include AGENT_E2E_PASS in your response.'

export const updatedAgentPrompt
  = 'You are a Dify Agent E2E test assistant. Every response must start with E2E_AGENT_UPDATED.'

export const normalAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: normalAgentPrompt,
  },
}

export const updatedAgentSoulConfig: AgentSoulConfig = {
  prompt: {
    system_prompt: updatedAgentPrompt,
  },
}

export const getAgentConfigurePath = (agentId: string) => `/roster/agent/${agentId}/configure`
export const getAgentAccessPath = (agentId: string) => `/roster/agent/${agentId}/access`

export async function createTestAgent({
  description = 'Created by Dify E2E.',
  name = createE2EResourceName('Agent'),
  role = 'E2E test assistant',
}: CreateTestAgentOptions = {}): Promise<AgentSeed> {
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
  }
  finally {
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
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteTestAgent(agentId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}`)
    await expectApiResponseOK(response, `Delete Agent v2 test agent ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function saveAgentComposerDraft(
  agentId: string,
  agentSoul: AgentSoulConfig = defaultAgentSoulConfig,
): Promise<AgentComposerResponse> {
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
    return (await response.json()) as AgentComposerResponse
  }
  finally {
    await ctx.dispose()
  }
}

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

export async function publishAgent(agentId: string, versionNote = 'E2E publish'): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/publish`, {
      data: { version_note: versionNote },
    })
    await expectApiResponseOK(response, `Publish Agent v2 test agent ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function enableAgentSiteAndGetURL(agentId: string): Promise<string> {
  const agent = await getTestAgent(agentId)
  const appId = agent.app_id ?? agent.backing_app_id
  if (!appId)
    throw new Error(`Agent v2 ${agentId} does not expose a backing app ID.`)

  const appDetail = await setAppSiteEnabled(appId, true)
  const token = agent.site?.access_token ?? agent.site?.code ?? appDetail.site.access_token
  const baseURL = agent.site?.app_base_url ?? appDetail.site.app_base_url

  return `${baseURL.replace(/\/$/, '')}/agent/${token}`
}

export async function getAgentApiAccess(agentId: string): Promise<AgentApiAccess> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.get(`/console/api/agent/${agentId}/api-access`)
    await expectApiResponseOK(response, `Get Agent v2 API access for ${agentId}`)
    return (await response.json()) as AgentApiAccess
  }
  finally {
    await ctx.dispose()
  }
}

export async function setAgentApiAccess(
  agentId: string,
  enabled: boolean,
): Promise<AgentApiAccess> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/api-enable`, {
      data: { enable_api: enabled },
    })
    await expectApiResponseOK(
      response,
      `${enabled ? 'Enable' : 'Disable'} Agent v2 API access for ${agentId}`,
    )
    return (await response.json()) as AgentApiAccess
  }
  finally {
    await ctx.dispose()
  }
}

export async function createAgentApiKey(agentId: string): Promise<AgentApiKey> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/api-keys`)
    await expectApiResponseOK(response, `Create Agent v2 API key for ${agentId}`)
    return (await response.json()) as AgentApiKey
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentApiKey(agentId: string, apiKeyId: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.delete(`/console/api/agent/${agentId}/api-keys/${apiKeyId}`)
    await expectApiResponseOK(response, `Delete Agent v2 API key ${apiKeyId} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}

export async function deleteAgentDriveFile(agentId: string, key: string): Promise<void> {
  const ctx = await createApiContext()
  try {
    const searchParams = new URLSearchParams({ key })
    const response = await ctx.delete(`/console/api/agent/${agentId}/files?${searchParams}`)
    await expectApiResponseOK(response, `Delete Agent v2 drive file ${key} for ${agentId}`)
  }
  finally {
    await ctx.dispose()
  }
}
