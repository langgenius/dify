import type { DocumentProcessingTaskEvent } from '@dify/contracts/knowledge-fs/types.gen'
import { withEventMeta } from '@orpc/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamProcessingTaskEvents } from '../services/processing-task-events'

const { mockStreamEvents } = vi.hoisted(() => ({
  mockStreamEvents: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    knowledgeFs: {
      getKnowledgeSpacesByIdDocumentsByDocumentIdProcessingTasksByTaskIdEvents: mockStreamEvents,
    },
  },
}))

async function* eventIterator(...events: DocumentProcessingTaskEvent[]) {
  yield* events
}

describe('KnowledgeFS processing task events', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the generated streaming client and resumes from the last event id', async () => {
    mockStreamEvents.mockResolvedValue(
      eventIterator(
        withEventMeta(
          {
            data: {
              progressPercent: 45,
              stage: 'parsed',
              state: 'running',
              updatedAt: '2026-07-20T01:02:03Z',
            },
            event: 'progress',
          },
          { id: 'task-1:2026-07-20T01:02:03Z' },
        ),
        withEventMeta(
          {
            data: { state: 'succeeded' },
            event: 'terminal',
          },
          { id: 'task-1:terminal' },
        ),
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
    expect(mockStreamEvents).toHaveBeenCalledWith(
      {
        headers: { 'last-event-id': 'task-1:previous' },
        params: {
          documentId: 'document/1',
          id: 'space/1',
          taskId: 'task/1',
        },
      },
      {
        context: { silent: true },
        signal: abortController.signal,
      },
    )
  })

  it('rejects events without a resumable event id', async () => {
    mockStreamEvents.mockResolvedValue(
      eventIterator({
        data: { state: 'failed' },
        event: 'terminal',
      }),
    )

    await expect(async () => {
      for await (const event of streamProcessingTaskEvents({
        documentId: 'document-1',
        knowledgeSpaceId: 'space-1',
        taskId: 'task-1',
      })) {
        void event
      }
    }).rejects.toThrow('missing an event id')
  })
})
