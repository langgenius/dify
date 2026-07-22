import type {
  AgentApiAccessResponse,
  AgentApiStatusPayload,
  ApiKeyItem,
} from '@dify/contracts/api/console/agent/types.gen'
import type {
  ChatRequestPayloadWithUser,
  PostChatMessagesResponse,
} from '@dify/contracts/api/service/types.gen'
import {
  zPostAgentByAgentIdApiEnableResponse,
  zPostAgentByAgentIdApiKeysResponse,
} from '@dify/contracts/api/console/agent/zod.gen'
import { createConsoleApiContext, expectApiResponseOK } from '../../../support/api/console-context'
import { setAppSiteEnabled } from '../../../support/api/web-apps'
import { getTestAgent } from './agent'
import { consumeServiceApiSse, SERVICE_API_STREAM_TIMEOUT_MS } from './service-api-sse'

export type AgentServiceApiChatResult = {
  body: PostChatMessagesResponse | unknown
  ok: boolean
  status: number
}

async function parseServiceApiChatResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) return consumeServiceApiSse(response.body)

  const text = await response.text().catch(() => '')

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return { message: text }
    }
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return { message: text }
  }
}

export async function setAgentSiteAccess(agentId: string, enabled: boolean): Promise<void> {
  const agent = await getTestAgent(agentId)
  const appId = agent.app_id ?? agent.backing_app_id
  if (!appId) throw new Error(`Agent v2 ${agentId} does not expose a backing app ID.`)

  await setAppSiteEnabled(appId, enabled)
}

export async function setAgentApiAccess(
  agentId: string,
  enabled: boolean,
): Promise<AgentApiAccessResponse> {
  const ctx = await createConsoleApiContext()
  try {
    const data = { enable_api: enabled } satisfies AgentApiStatusPayload
    const response = await ctx.post(`/console/api/agent/${agentId}/api-enable`, {
      data,
    })
    await expectApiResponseOK(
      response,
      `${enabled ? 'Enable' : 'Disable'} Agent v2 API access for ${agentId}`,
    )
    return zPostAgentByAgentIdApiEnableResponse.parse(await response.json())
  } finally {
    await ctx.dispose()
  }
}

export async function createAgentApiKey(agentId: string): Promise<ApiKeyItem> {
  const ctx = await createConsoleApiContext()
  try {
    const response = await ctx.post(`/console/api/agent/${agentId}/api-keys`)
    await expectApiResponseOK(response, `Create Agent v2 API key for ${agentId}`)
    return zPostAgentByAgentIdApiKeysResponse.parse(await response.json())
  } finally {
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
  const body = {
    inputs: {},
    query,
    response_mode: 'streaming',
    user: 'e2e-agent-access-point',
  } satisfies ChatRequestPayloadWithUser
  const signal = AbortSignal.timeout(SERVICE_API_STREAM_TIMEOUT_MS)

  try {
    const response = await fetch(`${serviceApiBaseURL.replace(/\/$/, '')}/chat-messages`, {
      body: JSON.stringify(body),
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal,
    })
    const responseBody = await parseServiceApiChatResponse(response)

    return {
      body: responseBody as PostChatMessagesResponse | unknown,
      ok: response.ok,
      status: response.status,
    }
  } catch (error) {
    if (signal.aborted) {
      throw new Error(
        `Agent v2 Service API stream timed out after ${SERVICE_API_STREAM_TIMEOUT_MS}ms.`,
        { cause: error },
      )
    }
    throw error
  }
}
