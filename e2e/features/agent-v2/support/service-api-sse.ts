import type { EventSourceMessage } from 'eventsource-parser'
import { EventSourceParserStream } from 'eventsource-parser/stream'

const SERVICE_API_SSE_MAX_BUFFER_SIZE = 1_048_576
const SERVICE_API_SSE_SUMMARY_LIMIT = 2_000
const SUCCESS_TERMINAL_EVENTS = new Set(['message_end', 'workflow_finished'])

export const SERVICE_API_STREAM_TIMEOUT_MS = 120_000
export const SERVICE_API_RUNTIME_STEP_TIMEOUT_MS = SERVICE_API_STREAM_TIMEOUT_MS + 10_000

export type ServiceApiSseEvent = {
  data: unknown
  event?: string
  id?: string
}

export type ServiceApiSseResult = {
  answer: string
  events: ServiceApiSseEvent[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
)

const truncate = (value: string, limit = SERVICE_API_SSE_SUMMARY_LIMIT) => (
  value.length > limit ? `${value.slice(0, limit)}...` : value
)

const parseEventData = (event: EventSourceMessage) => {
  try {
    return JSON.parse(event.data) as unknown
  }
  catch (error) {
    throw new Error(
      `Agent v2 Service API SSE event contained invalid JSON: ${truncate(JSON.stringify(event.data))}`,
      { cause: error },
    )
  }
}

const getEventName = (event: EventSourceMessage, data: unknown) => {
  if (event.event)
    return event.event
  if (isRecord(data) && typeof data.event === 'string')
    return data.event
  return undefined
}

const summarizeEvents = (events: ServiceApiSseEvent[]) => truncate(JSON.stringify(events.map((event) => {
  if (!isRecord(event.data))
    return { event: event.event, data: truncate(String(event.data), 200) }

  const data = event.data
  return {
    event: event.event,
    ...(['code', 'message', 'conversation_id', 'message_id', 'task_id'] as const).reduce<Record<string, unknown>>(
      (summary, key) => {
        if (key in data)
          summary[key] = data[key]
        return summary
      },
      {},
    ),
  }
})))

const createBackendError = (event: ServiceApiSseEvent, events: ServiceApiSseEvent[]) => {
  const data = event.data
  const details = isRecord(data)
    ? (['code', 'message', 'conversation_id', 'message_id', 'task_id'] as const)
        .flatMap(key => key in data ? [`${key}=${JSON.stringify(data[key])}`] : [])
        .join(' ')
    : `data=${JSON.stringify(data)}`

  return new Error(
    `Agent v2 Service API SSE error${details ? `: ${details}` : ''}. Received events: ${summarizeEvents(events)}`,
  )
}

export async function consumeServiceApiSse(
  body: ReadableStream<BufferSource> | null,
): Promise<ServiceApiSseResult> {
  if (!body)
    throw new Error('Agent v2 Service API SSE response did not expose a readable body.')

  const events: ServiceApiSseEvent[] = []
  const answers: string[] = []
  const stream = body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({
      maxBufferSize: SERVICE_API_SSE_MAX_BUFFER_SIZE,
      onError: 'terminate',
    }))

  try {
    for await (const message of stream) {
      const data = parseEventData(message)
      const eventName = getEventName(message, data)
      const event: ServiceApiSseEvent = {
        data,
        ...(eventName ? { event: eventName } : {}),
        ...(message.id ? { id: message.id } : {}),
      }
      events.push(event)

      if (isRecord(data) && typeof data.answer === 'string')
        answers.push(data.answer)

      if (eventName === 'error')
        throw createBackendError(event, events)

      if (eventName && SUCCESS_TERMINAL_EVENTS.has(eventName)) {
        return {
          answer: answers.join(''),
          events,
        }
      }
    }
  }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('Agent v2 Service API SSE'))
      throw error

    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Agent v2 Service API SSE parsing failed: ${message}. Received events: ${summarizeEvents(events)}`,
      { cause: error },
    )
  }

  throw new Error(
    `Agent v2 Service API SSE stream closed before a terminal event. Received events: ${summarizeEvents(events)}`,
  )
}
