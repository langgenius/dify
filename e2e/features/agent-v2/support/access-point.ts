import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatRequestPayloadWithUser } from '@dify/contracts/api/service/types.gen'
import { consumeServiceApiSse, SERVICE_API_STREAM_TIMEOUT_MS } from './service-api-sse'

export type AgentServiceApiChatResult = {
  body: unknown
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

export function getAgentWebAppURL(agent: AgentAppDetailWithSite): string {
  const token = agent.site?.access_token ?? agent.site?.code
  if (!token) throw new Error(`Agent v2 ${agent.id} does not expose a Web app access token.`)

  const baseURL = agent.site?.app_base_url
  if (!baseURL) throw new Error(`Agent v2 ${agent.id} does not expose a Web app base URL.`)

  return `${baseURL.replace(/\/$/, '')}/agent/${token}`
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
      body: responseBody,
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
