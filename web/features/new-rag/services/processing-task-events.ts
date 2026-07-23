import { requestConsoleResponse } from '@/service/client'

const PROCESSING_TASK_STAGES = [
  'queued',
  'parsed',
  'outline_built',
  'nodes_generated',
  'projection_built',
  'smoke_eval_passed',
  'published',
] as const

const PROCESSING_TASK_STATES = [
  'dispatch_pending',
  'queued',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'canceled',
  'superseded',
] as const

const TERMINAL_TASK_STATES = ['succeeded', 'failed', 'canceled', 'superseded'] as const

type ProcessingTaskStage = (typeof PROCESSING_TASK_STAGES)[number]
type ProcessingTaskState = (typeof PROCESSING_TASK_STATES)[number]
type TerminalTaskState = (typeof TERMINAL_TASK_STATES)[number]

type ProcessingTaskProgressEvent = {
  data: {
    progressPercent: number
    stage: ProcessingTaskStage
    state: ProcessingTaskState
    updatedAt: string
  }
  event: 'progress'
  id: string
}

type ProcessingTaskTerminalEvent = {
  data: {
    errorCode?: string
    state: TerminalTaskState
  }
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

const isEnumValue = <T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] => {
  return typeof value === 'string' && values.includes(value)
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
  if (
    typeof value.progressPercent !== 'number' ||
    !Number.isFinite(value.progressPercent) ||
    !Number.isInteger(value.progressPercent) ||
    value.progressPercent < 0 ||
    value.progressPercent > 100 ||
    !isEnumValue(PROCESSING_TASK_STAGES, value.stage) ||
    !isEnumValue(PROCESSING_TASK_STATES, value.state) ||
    typeof value.updatedAt !== 'string'
  ) {
    throw new Error('KnowledgeFS processing task progress event has an invalid payload')
  }
  return {
    progressPercent: value.progressPercent,
    stage: value.stage,
    state: value.state,
    updatedAt: value.updatedAt,
  }
}

function parseTerminalEventData(data: string): ProcessingTaskTerminalEvent['data'] {
  const value = parseEventData('terminal', data)
  if (!isEnumValue(TERMINAL_TASK_STATES, value.state)) {
    throw new Error('KnowledgeFS processing task terminal event has an invalid payload')
  }
  if (value.errorCode !== undefined && typeof value.errorCode !== 'string') {
    throw new Error('KnowledgeFS processing task terminal event has an invalid error code')
  }
  return {
    ...(value.errorCode ? { errorCode: value.errorCode } : {}),
    state: value.state,
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

export async function* streamProcessingTaskEvents(
  input: StreamProcessingTaskEventsInput,
): AsyncGenerator<ProcessingTaskEvent> {
  const knowledgeSpaceId = encodeURIComponent(input.knowledgeSpaceId)
  const documentId = encodeURIComponent(input.documentId)
  const taskId = encodeURIComponent(input.taskId)
  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (input.lastEventId) headers['Last-Event-ID'] = input.lastEventId

  const response = await requestConsoleResponse(
    `/knowledge-fs/knowledge-spaces/${knowledgeSpaceId}/documents/${documentId}/processing-tasks/${taskId}/events`,
    { headers, signal: input.signal },
    { silent: true },
  )
  if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('KnowledgeFS processing task stream returned an invalid content type')
  }
  if (!response.body) throw new Error('KnowledgeFS processing task stream returned no body')

  yield* parseProcessingTaskEventStream(response.body)
}
