import type {
  KnowledgeFsResearchTaskResponse,
  KnowledgeFsStreamCapabilityResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { streamCapabilityEvents } from './knowledge-query-events'

export type ResearchTaskProgressEvent = {
  createdAt: string
  id: string
  payload: Record<string, unknown>
  researchTaskJobId: string
  sequence: number
  stage: KnowledgeFsResearchTaskResponse['stage']
  type:
    | 'research_task.answer_delta'
    | 'research_task.canceled'
    | 'research_task.failed'
    | 'research_task.paused'
    | 'research_task.resumed'
    | 'research_task.stage_changed'
    | 'research_task.started'
}

export type ResearchTaskEventStreamResult = {
  cursor?: string
  reconnect: boolean
  terminal: boolean
}

const researchStages = new Set<KnowledgeFsResearchTaskResponse['stage']>([
  'analyzing',
  'canceled',
  'completed',
  'failed',
  'generating',
  'paused',
  'planning',
  'queued',
  'retrieving',
])

const progressEventTypes = new Set<ResearchTaskProgressEvent['type']>([
  'research_task.answer_delta',
  'research_task.canceled',
  'research_task.failed',
  'research_task.paused',
  'research_task.resumed',
  'research_task.stage_changed',
  'research_task.started',
])

function progressEvent(value: unknown): ResearchTaskProgressEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const event = value as Record<string, unknown>
  if (
    typeof event.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(event.createdAt)) ||
    typeof event.id !== 'string' ||
    !event.id ||
    typeof event.researchTaskJobId !== 'string' ||
    !event.researchTaskJobId ||
    typeof event.sequence !== 'number' ||
    !Number.isInteger(event.sequence) ||
    typeof event.stage !== 'string' ||
    !researchStages.has(event.stage as KnowledgeFsResearchTaskResponse['stage']) ||
    typeof event.type !== 'string' ||
    !progressEventTypes.has(event.type as ResearchTaskProgressEvent['type'])
  )
    return
  const payload =
    event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {}
  return {
    createdAt: event.createdAt,
    id: event.id,
    payload,
    researchTaskJobId: event.researchTaskJobId,
    sequence: event.sequence,
    stage: event.stage as KnowledgeFsResearchTaskResponse['stage'],
    type: event.type as ResearchTaskProgressEvent['type'],
  }
}

function streamUrl(url: string, cursor: string | undefined) {
  if (!cursor) return url
  return `${url}${url.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`
}

function timeoutCursor(data: unknown) {
  if (!data || typeof data !== 'object') return
  const cursor = (data as Record<string, unknown>).cursor
  return typeof cursor === 'string' && cursor ? cursor : undefined
}

function positiveSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function nonnegativeSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function researchTaskAnswerFromEvents(events: ResearchTaskProgressEvent[]) {
  let executionAttempt = 0
  let text = ''

  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    const eventAttempt = positiveSafeInteger(event.payload.executionAttempt)
    if (
      event.type !== 'research_task.answer_delta' &&
      event.payload.workerClaimed === true &&
      eventAttempt !== undefined &&
      eventAttempt > executionAttempt
    ) {
      executionAttempt = eventAttempt
      text = ''
      continue
    }
    if (event.type !== 'research_task.answer_delta') continue

    const delta = event.payload.delta
    const offset = nonnegativeSafeInteger(event.payload.offset)
    if (
      eventAttempt === undefined ||
      offset === undefined ||
      offset > 20_000 ||
      typeof delta !== 'string' ||
      !delta ||
      delta.length > 20_000 ||
      eventAttempt < executionAttempt
    )
      continue
    if (eventAttempt > executionAttempt) {
      executionAttempt = eventAttempt
      text = ''
    }
    if (offset > text.length) continue

    const overlap = text.slice(offset)
    if (overlap.startsWith(delta)) continue
    if (!delta.startsWith(overlap)) continue
    text += delta.slice(overlap.length)
  }

  return text
}

export async function streamResearchTaskEvents({
  capability,
  cursor,
  onEvent,
  signal,
}: {
  capability: KnowledgeFsStreamCapabilityResponse
  cursor?: string
  onEvent: (event: ResearchTaskProgressEvent) => void
  signal?: AbortSignal
}): Promise<ResearchTaskEventStreamResult> {
  let nextCursor = cursor
  let reconnectAfterTimeout = false
  let terminal = false
  await streamCapabilityEvents({
    onEvent: (event) => {
      if (event.event === 'timeout') {
        nextCursor = timeoutCursor(event.data) ?? nextCursor
        reconnectAfterTimeout = true
        return
      }
      const parsed = progressEvent(event.data)
      if (!parsed) return
      nextCursor = String(parsed.sequence)
      terminal =
        parsed.stage === 'canceled' || parsed.stage === 'completed' || parsed.stage === 'failed'
      onEvent(parsed)
    },
    signal,
    token: capability.token,
    url: streamUrl(capability.url, cursor),
  })
  return {
    ...(nextCursor ? { cursor: nextCursor } : {}),
    reconnect: !terminal && (reconnectAfterTimeout || nextCursor !== cursor),
    terminal,
  }
}
