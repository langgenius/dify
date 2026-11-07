import type { KnowledgeFsStreamCapabilityResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ResearchTaskProgressEvent } from '../research-task-events'
import { researchTaskAnswerFromEvents, streamResearchTaskEvents } from '../research-task-events'

describe('streamResearchTaskEvents', () => {
  it('gets the capability stream and validates progress events', async () => {
    const encoder = new TextEncoder()
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'id: 1\nevent: research_task.progress\ndata: {"createdAt":"2026-07-31T10:00:00.000Z","id":"event-1","payload":{},"researchTaskJobId":"task-1","sequence":1,"stage":"planning","type":"research_task.started"}\n\n',
          ),
        )
        controller.enqueue(
          encoder.encode(
            'id: 2\nevent: answer.delta\ndata: {"createdAt":"2026-07-31T10:00:10.000Z","id":"event-2","payload":{"delta":"The answer","executionAttempt":1,"offset":0},"researchTaskJobId":"task-1","sequence":2,"stage":"generating","type":"research_task.answer_delta"}\n\n',
          ),
        )
        controller.enqueue(
          encoder.encode(
            'id: 3\nevent: completed\ndata: {"createdAt":"2026-07-31T10:00:12.000Z","id":"event-3","payload":{},"researchTaskJobId":"task-1","sequence":3,"stage":"completed","type":"research_task.stage_changed"}\n\n',
          ),
        )
        controller.close()
      },
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(responseBody, { status: 200 }))
    const events: unknown[] = []
    const capability: KnowledgeFsStreamCapabilityResponse = {
      expires_at: '2026-07-31T10:05:00.000Z',
      operation_id: 'streamResearchTask',
      token: `header.${btoa(JSON.stringify({ trace_id: 'research-trace-1' }))}.signature`,
      url: 'https://knowledge.example.test/research/events',
    }

    const result = await streamResearchTaskEvents({
      capability,
      onEvent: (event) => events.push(event),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      capability.url,
      expect.objectContaining({
        credentials: 'omit',
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          Authorization: `Bearer ${capability.token}`,
          'X-Trace-ID': 'research-trace-1',
        }),
        method: 'GET',
      }),
    )
    expect(events).toEqual([
      {
        createdAt: '2026-07-31T10:00:00.000Z',
        id: 'event-1',
        payload: {},
        researchTaskJobId: 'task-1',
        sequence: 1,
        stage: 'planning',
        type: 'research_task.started',
      },
      {
        createdAt: '2026-07-31T10:00:10.000Z',
        id: 'event-2',
        payload: { delta: 'The answer', executionAttempt: 1, offset: 0 },
        researchTaskJobId: 'task-1',
        sequence: 2,
        stage: 'generating',
        type: 'research_task.answer_delta',
      },
      {
        createdAt: '2026-07-31T10:00:12.000Z',
        id: 'event-3',
        payload: {},
        researchTaskJobId: 'task-1',
        sequence: 3,
        stage: 'completed',
        type: 'research_task.stage_changed',
      },
    ])
    expect(result).toEqual({ cursor: '3', reconnect: false, terminal: true })

    fetchMock.mockRestore()
  })

  it('reconstructs answer deltas idempotently and resets a retried attempt', () => {
    const event = (
      sequence: number,
      type: ResearchTaskProgressEvent['type'],
      payload: Record<string, unknown>,
    ): ResearchTaskProgressEvent => ({
      createdAt: `2026-07-31T10:00:0${sequence}.000Z`,
      id: `event-${sequence}`,
      payload,
      researchTaskJobId: 'task-1',
      sequence,
      stage: 'generating',
      type,
    })

    expect(
      researchTaskAnswerFromEvents([
        event(1, 'research_task.stage_changed', { executionAttempt: 1, workerClaimed: true }),
        event(2, 'research_task.answer_delta', {
          delta: 'Old answer',
          executionAttempt: 1,
          offset: 0,
        }),
        event(3, 'research_task.answer_delta', {
          delta: 'Old answer',
          executionAttempt: 1,
          offset: 0,
        }),
        event(4, 'research_task.stage_changed', { executionAttempt: 2, workerClaimed: true }),
        event(5, 'research_task.answer_delta', {
          delta: 'New ',
          executionAttempt: 2,
          offset: 0,
        }),
        event(6, 'research_task.answer_delta', {
          delta: 'answer',
          executionAttempt: 2,
          offset: 4,
        }),
      ]),
    ).toBe('New answer')
  })

  it('resumes from the latest cursor after a timeout', async () => {
    const encoder = new TextEncoder()
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'id: 3\nevent: research_task.progress\ndata: {"createdAt":"2026-07-31T10:00:20.000Z","id":"event-3","payload":{},"researchTaskJobId":"task-1","sequence":3,"stage":"retrieving","type":"research_task.stage_changed"}\n\n',
          ),
        )
        controller.enqueue(
          encoder.encode('event: timeout\ndata: {"cursor":"3","researchTaskJobId":"task-1"}\n\n'),
        )
        controller.close()
      },
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(responseBody, { status: 200 }))
    const capability: KnowledgeFsStreamCapabilityResponse = {
      expires_at: '2026-07-31T10:05:00.000Z',
      operation_id: 'streamResearchTask',
      token: `header.${btoa(JSON.stringify({ trace_id: 'research-trace-1' }))}.signature`,
      url: 'https://knowledge.example.test/research/events?knowledgeSpaceId=space-1',
    }

    const result = await streamResearchTaskEvents({
      capability,
      cursor: '2',
      onEvent: vi.fn(),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${capability.url}&cursor=2`,
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result).toEqual({ cursor: '3', reconnect: true, terminal: false })

    fetchMock.mockRestore()
  })
})
