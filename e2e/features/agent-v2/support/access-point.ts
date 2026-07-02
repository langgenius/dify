import type {
  AgentApiAccessResponse,
  ApiKeyItem,
} from '@dify/contracts/api/console/agent/types.gen'
import type {
  ChatRequestPayloadWithUser,
  PostChatMessagesResponse,
} from '@dify/contracts/api/service/types.gen'
import { request } from '@playwright/test'
import { createApiContext, expectApiResponseOK, setAppSiteEnabled } from '../../../support/api'
import { getTestAgent } from './agent'

export type AgentServiceApiChatResult = {
  body: PostChatMessagesResponse | unknown
  ok: boolean
  status: number
}

export async function setAgentSiteAccessAndGetURL(
  agentId: string,
  enabled: boolean,
): Promise<string> {
  const agent = await getTestAgent(agentId)
  const appId = agent.app_id ?? agent.backing_app_id
  if (!appId)
    throw new Error(`Agent v2 ${agentId} does not expose a backing app ID.`)

  const appDetail = await setAppSiteEnabled(appId, enabled)
  const token = agent.site?.access_token ?? agent.site?.code ?? appDetail.site.access_token
  const baseURL = agent.site?.app_base_url ?? appDetail.site.app_base_url

  return `${baseURL.replace(/\/$/, '')}/agent/${token}`
}

export async function setAgentApiAccess(
  agentId: string,
  enabled: boolean,
): Promise<AgentApiAccessResponse> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/api-enable`, {
      data: { enable_api: enabled },
    })
    await expectApiResponseOK(
      response,
      `${enabled ? 'Enable' : 'Disable'} Agent v2 API access for ${agentId}`,
    )
    return (await response.json()) as AgentApiAccessResponse
  }
  finally {
    await ctx.dispose()
  }
}

export async function createAgentApiKey(agentId: string): Promise<ApiKeyItem> {
  const ctx = await createApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/api-keys`)
    await expectApiResponseOK(response, `Create Agent v2 API key for ${agentId}`)
    return (await response.json()) as ApiKeyItem
  }
  finally {
    await ctx.dispose()
  }
}

export async function sendAgentServiceApiChatMessage({
  apiKey,
  query = 'Please reply with the test success marker.',
  serviceApiBaseURL,
}: {
  apiKey: string
  query?: string
  serviceApiBaseURL: string
}): Promise<AgentServiceApiChatResult> {
  const ctx = await request.newContext()
  const body = {
    inputs: {},
    query,
    response_mode: 'blocking',
    user: 'e2e-agent-access-point',
  } satisfies ChatRequestPayloadWithUser

  try {
    const response = await ctx.post(`${serviceApiBaseURL.replace(/\/$/, '')}/chat-messages`, {
      data: body,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    const responseBody = await response.json().catch(async () => ({
      message: await response.text().catch(() => ''),
    }))

    return {
      body: responseBody as PostChatMessagesResponse | unknown,
      ok: response.ok(),
      status: response.status(),
    }
  }
  finally {
    await ctx.dispose()
  }
}
