import type {
  DocumentProcessingTask,
  GetKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEventsData,
} from '@dify/contracts/knowledge-fs/types.gen'
import { zDocumentProcessingTask } from '@dify/contracts/knowledge-fs/zod.gen'
import { API_PREFIX } from '@/config'
// oxlint-disable-next-line no-restricted-imports -- This feature-specific adapter must preserve the SSE response body.
import { request } from '@/service/base'
import { getBaseURL } from '@/service/client'
import { normalizeConsoleOpenAPIURL } from '@/service/console-openapi-url'

const TERMINAL_TASK_STATES = ['succeeded', 'failed', 'canceled', 'superseded'] as const

type TerminalTaskState = (typeof TERMINAL_TASK_STATES)[number]
type ProcessingTaskProgressData = Pick<
  DocumentProcessingTask,
  'progressPercent' | 'stage' | 'state' | 'updatedAt'
>
type ProcessingTaskTerminalData = Pick<DocumentProcessingTask, 'errorCode'> & {
  state: TerminalTaskState
}

const processingTaskProgressDataSchema = zDocumentProcessingTask.pick({
  progressPercent: true,
  stage: true,
  state: true,
  updatedAt: true,
})
const processingTaskTerminalDataSchema = zDocumentProcessingTask.pick({
  errorCode: true,
  state: true,
})
const PROCESSING_TASK_EVENTS_PATH =
  '/knowledge-fs/knowledge-spaces/{id}/documents/{documentId}/processing-tasks/{taskId}/events' satisfies GetKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEventsData['url']

type ProcessingTaskProgressEvent = {
  data: ProcessingTaskProgressData
  event: 'progress'
  id: string
}

type ProcessingTaskTerminalEvent = {
  data: ProcessingTaskTerminalData
  event: 'terminal'
  id: string
}

export type ProcessingTaskEvent = ProcessingTaskProgressEvent | ProcessingTaskTerminalEvent

type StreamProcessingTaskEventsInput = {
  documentId: string
  knowledgeSpaceId: string
  lastEventId?: string
  signal?: AbortSignal
  taskId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isTerminalTaskState = (
  value: DocumentProcessingTask['state'],
): value is TerminalTaskState => {
  return (TERMINAL_TASK_STATES as readonly DocumentProcessingTask['state'][]).includes(value)
}

function parseEventData(event: string, data: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    throw new Error(`KnowledgeFS processing task ${event} event contains invalid JSON`)
  }
  if (!isRecord(value))
    throw new Error(`KnowledgeFS processing task ${event} event is not an object`)
  return value
}

function parseProgressEventData(data: string): ProcessingTaskProgressEvent['data'] {
  const value = parseEventData('progress', data)
  const result = processingTaskProgressDataSchema.safeParse(value)
  if (!result.success) {
    throw new Error('KnowledgeFS processing task progress event has an invalid payload')
  }
  return result.data
}

function parseTerminalEventData(data: string): ProcessingTaskTerminalEvent['data'] {
  const value = parseEventData('terminal', data)
  const result = processingTaskTerminalDataSchema.safeParse(value)
  if (!result.success || !isTerminalTaskState(result.data.state)) {
    throw new Error('KnowledgeFS processing task terminal event has an invalid payload')
  }
  return {
    ...(result.data.errorCode === undefined ? {} : { errorCode: result.data.errorCode }),
    state: result.data.state,
  }
}

function parseEventBlock(block: string): ProcessingTaskEvent | null {
  let event = ''
  let id = ''
  const dataLines: string[] = []

  for (const line of block.split(/\r\n|\r|\n/)) {
    if (!line || line.startsWith(':')) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    const rawValue = separator === -1 ? '' : line.slice(separator + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
    if (field === 'event') event = value
    else if (field === 'id') id = value
    else if (field === 'data') dataLines.push(value)
  }

  if (!event && !id && dataLines.length === 0) return null
  if (event !== 'progress' && event !== 'terminal') {
    throw new Error(
      `KnowledgeFS processing task stream returned unsupported event: ${event || 'message'}`,
    )
  }
  if (!id || dataLines.length === 0) {
    throw new Error(`KnowledgeFS processing task ${event} event is incomplete`)
  }

  const data = dataLines.join('\n')
  if (event === 'progress') return { data: parseProgressEventData(data), event, id }
  return { data: parseTerminalEventData(data), event, id }
}

export async function* parseProcessingTaskEventStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ProcessingTaskEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      let separator = buffer.match(/\r\n\r\n|\r\r|\n\n/)
      while (separator?.index !== undefined) {
        const block = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const event = parseEventBlock(block)
        if (event) yield event
        separator = buffer.match(/\r\n\r\n|\r\r|\n\n/)
      }

      if (done) {
        const event = parseEventBlock(buffer)
        if (event) yield event
        completed = true
        break
      }
    }
  } finally {
    if (!completed) await reader.cancel()
    reader.releaseLock()
  }
}

function requestProcessingTaskEventStream(
  input: StreamProcessingTaskEventsInput,
  headers: Record<string, string>,
) {
  const route = PROCESSING_TASK_EVENTS_PATH.replace(
    '{id}',
    encodeURIComponent(input.knowledgeSpaceId),
  )
    .replace('{documentId}', encodeURIComponent(input.documentId))
    .replace('{taskId}', encodeURIComponent(input.taskId))
  const baseURL = getBaseURL(API_PREFIX)
  baseURL.pathname = `${baseURL.pathname.replace(/\/$/, '')}/`
  const url = new URL(route.replace(/^\//, ''), baseURL)
  const requestInput = new Request(url)

  return request<Response>(
    normalizeConsoleOpenAPIURL(requestInput.url),
    { headers, signal: input.signal },
    {
      fetchCompat: true,
      request: requestInput,
      silent: true,
    },
  )
}

export async function* streamProcessingTaskEvents(
  input: StreamProcessingTaskEventsInput,
): AsyncGenerator<ProcessingTaskEvent> {
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (input.lastEventId) headers['Last-Event-ID'] = input.lastEventId

  const response = await requestProcessingTaskEventStream(input, headers)
  if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('KnowledgeFS processing task stream returned an invalid content type')
  }
  if (!response.body) throw new Error('KnowledgeFS processing task stream returned no body')

  yield* parseProcessingTaskEventStream(response.body)
}
