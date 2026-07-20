import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestConsoleResponse } from '@/service/client'
import {
  parseProcessingTaskEventStream,
  streamProcessingTaskEvents,
} from '../services/processing-task-events'

vi.mock('@/service/client', () => ({ requestConsoleResponse: vi.fn() }))

const mockRequestConsoleResponse = vi.mocked(requestConsoleResponse)
const encoder = new TextEncoder()

function eventStream(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
}

describe('KnowledgeFS processing task events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('consumes progress and terminal events split across transport chunks', async () => {
    const stream = eventStream(
      ': heartbeat\n\nid: task-1:2026-07-20T01:02:03Z\nevent: progress\ndata: {"progressPercent":45,',
      '"stage":"parsed","state":"running","updatedAt":"2026-07-20T01:02:03Z"}\n\n',
      'id: task-1:terminal\nevent: terminal\ndata: {"state":"succeeded"}\n\n',
    )

    const events = []
    for await (const event of parseProcessingTaskEventStream(stream)) events.push(event)

    expect(events).toEqual([
      {
        data: {
          progressPercent: 45,
          stage: 'parsed',
          state: 'running',
          updatedAt: '2026-07-20T01:02:03Z',
        },
        event: 'progress',
        id: 'task-1:2026-07-20T01:02:03Z',
      },
      {
        data: { state: 'succeeded' },
        event: 'terminal',
        id: 'task-1:terminal',
      },
    ])
  })

  it('uses the raw streaming transport and restores from Last-Event-ID', async () => {
    mockRequestConsoleResponse.mockResolvedValue(
      new Response(
        eventStream(
          'id: task-1:terminal\nevent: terminal\ndata: {"state":"failed","errorCode":"PARSER_FAILED"}\n\n',
        ),
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
      ),
    )
    const abortController = new AbortController()

    const events = []
    for await (const event of streamProcessingTaskEvents({
      documentId: 'document/1',
      knowledgeSpaceId: 'space/1',
      lastEventId: 'task-1:previous',
      signal: abortController.signal,
      taskId: 'task/1',
    })) {
      events.push(event)
    }

    expect(events).toEqual([
      {
        data: { errorCode: 'PARSER_FAILED', state: 'failed' },
        event: 'terminal',
        id: 'task-1:terminal',
      },
    ])
    expect(mockRequestConsoleResponse).toHaveBeenCalledWith(
      '/knowledge-fs/knowledge-spaces/space%2F1/documents/document%2F1/processing-tasks/task%2F1/events',
      {
        headers: { Accept: 'text/event-stream', 'Last-Event-ID': 'task-1:previous' },
        signal: abortController.signal,
      },
      { silent: true },
    )
  })

  it('rejects event names outside the pinned KnowledgeFS vocabulary', async () => {
    const stream = eventStream('id: task-1\nevent: message\ndata: {}\n\n')

    await expect(async () => {
      for await (const event of parseProcessingTaskEventStream(stream)) void event
    }).rejects.toThrow('unsupported event: message')
  })
})
