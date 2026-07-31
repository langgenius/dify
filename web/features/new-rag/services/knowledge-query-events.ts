import type { KnowledgeFsQueryAdmissionResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'

export type KnowledgeQueryEvent = {
  data: unknown
  event?: string
  id?: string
}

function parseEventBlock(block: string): KnowledgeQueryEvent | undefined {
  let event: string | undefined
  let id: string | undefined
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator < 0 ? line : line.slice(0, separator)
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '')
    if (field === 'event') event = value
    else if (field === 'id') id = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length && !event) return undefined
  const rawData = data.join('\n')
  let parsed: unknown = rawData
  if (rawData) {
    try {
      parsed = JSON.parse(rawData)
    } catch {
      parsed = rawData
    }
  }
  return { data: parsed, event, id }
}

function capabilityTraceId(token: string) {
  const payload = token.split('.')[1]
  if (!payload) throw new Error('KnowledgeFS stream capability is malformed')
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (
      claims &&
      typeof claims === 'object' &&
      'trace_id' in claims &&
      typeof claims.trace_id === 'string' &&
      claims.trace_id.trim()
    )
      return claims.trace_id.trim()
  } catch {
    // The signed token is verified by KnowledgeFS; the client only echoes its public trace claim.
  }
  throw new Error('KnowledgeFS stream capability is missing its trace binding')
}

export async function streamCapabilityEvents({
  body,
  method = 'GET',
  onEvent,
  signal,
  token,
  url,
}: {
  body?: unknown
  method?: 'GET' | 'POST'
  onEvent: (event: KnowledgeQueryEvent) => void
  signal?: AbortSignal
  token: string
  url: string
}) {
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    Authorization: `Bearer ${token}`,
    'X-Trace-ID': capabilityTraceId(token),
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, {
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    credentials: 'omit',
    headers,
    method,
    signal,
  })
  if (!response.ok) throw response
  if (!response.body) throw new Error('KnowledgeFS event stream has no response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n')
    let separator = buffer.indexOf('\n\n')
    while (separator >= 0) {
      const block = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const event = parseEventBlock(block)
      if (event) onEvent(event)
      separator = buffer.indexOf('\n\n')
    }
    if (done) break
  }
  const trailingEvent = parseEventBlock(buffer)
  if (trailingEvent) onEvent(trailingEvent)
}

export async function streamKnowledgeQuery({
  admission,
  onEvent,
  signal,
}: {
  admission: KnowledgeFsQueryAdmissionResponse
  onEvent: (event: KnowledgeQueryEvent) => void
  signal?: AbortSignal
}) {
  await streamCapabilityEvents({
    body: admission.request,
    method: 'POST',
    onEvent,
    signal,
    token: admission.token,
    url: admission.url,
  })
}
