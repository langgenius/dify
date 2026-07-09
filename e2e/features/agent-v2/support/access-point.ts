import type {
  AgentApiAccessResponse,
  ApiKeyItem,
} from '@dify/contracts/api/console/agent/types.gen'
import type {
  ChatRequestPayloadWithUser,
  PostChatMessagesResponse,
} from '@dify/contracts/api/service/types.gen'
import { createApiContext, expectApiResponseOK, setAppSiteEnabled } from '../../../support/api'
import { getTestAgent } from './agent'

const SERVICE_API_STREAM_TIMEOUT_MS = 120_000

export type AgentServiceApiChatResult = {
  body: PostChatMessagesResponse | unknown
  ok: boolean
  status: number
}

type ServiceApiSseEvent = {
  data: unknown
  event?: string
}

async function parseServiceApiChatResponse(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream'))
    return parseServiceApiSseStream(response)

  const text = await response.text().catch(() => '')

  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as unknown
    }
    catch {
      return { message: text }
    }
  }

  try {
    return JSON.parse(text) as unknown
  }
  catch {
    return { message: text }
  }
}

async function parseServiceApiSseStream(response: Response) {
  if (!response.body)
    return parseServiceApiSseText(await response.text().catch(() => ''))

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      raw += decoder.decode(value, { stream: true })
      const parsed = parseServiceApiSseText(raw)
      if (parsed.events.some(isTerminalServiceApiEvent)) {
        await reader.cancel().catch(() => {})
        return parsed
      }
    }
  }
  finally {
    reader.releaseLock()
  }

  raw += decoder.decode()
  return parseServiceApiSseText(raw)
}

function parseServiceApiSseText(text: string) {
  const events: ServiceApiSseEvent[] = []
  const answers: string[] = []

  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const eventName = lines
      .find(line => line.startsWith('event:'))
      ?.slice('event:'.length)
      .trim()
    const dataText = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())
      .join('\n')

    if (!dataText)
      continue

    let data: unknown = dataText
    try {
      data = JSON.parse(dataText) as unknown
    }
    catch {
      data = dataText
    }

    events.push({
      data,
      ...(eventName ? { event: eventName } : {}),
    })

    if (
      data
      && typeof data === 'object'
      && !Array.isArray(data)
      && 'answer' in data
      && typeof data.answer === 'string'
    ) {
      answers.push(data.answer)
    }
  }

  return {
    answer: answers.join(''),
    events,
    raw: text,
  }
}

function isTerminalServiceApiEvent(event: ServiceApiSseEvent) {
  if (event.event === 'message_end' || event.event === 'workflow_finished' || event.event === 'error')
    return true

  const data = event.data
  return Boolean(
    data
    && typeof data === 'object'
    && !Array.isArray(data)
    && 'event' in data
    && (
      data.event === 'message_end'
      || data.event === 'workflow_finished'
      || data.event === 'error'
    ),
  )
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
  const body = {
    inputs: {},
    query,
    response_mode: 'streaming',
    user: 'e2e-agent-access-point',
  } satisfies ChatRequestPayloadWithUser

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), SERVICE_API_STREAM_TIMEOUT_MS)

  try {
    const response = await fetch(`${serviceApiBaseURL.replace(/\/$/, '')}/chat-messages`, {
      body: JSON.stringify(body),
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      signal: controller.signal,
    })
    const responseBody = await parseServiceApiChatResponse(response)

    return {
      body: responseBody as PostChatMessagesResponse | unknown,
      ok: response.ok,
      status: response.status,
    }
  }
  finally {
    clearTimeout(timeout)
  }
}
