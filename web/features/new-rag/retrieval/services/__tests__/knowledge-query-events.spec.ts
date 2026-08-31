import type { KnowledgeFsQueryAdmissionResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { streamKnowledgeQuery } from '../knowledge-query-events'

describe('streamKnowledgeQuery', () => {
  it('posts the admitted request and parses chunked SSE events', async () => {
    const encoder = new TextEncoder()
    const responseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: evidence\ndata: {"chunk":'))
        controller.enqueue(encoder.encode('{"id":"chunk-1"}}\n\n'))
        controller.enqueue(
          encoder.encode(': keep-alive\n\nevent: done\ndata: {"trace_id":"trace-1"}\n\n'),
        )
        controller.close()
      },
    })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(responseBody, { status: 200 }))
    const events: unknown[] = []
    const admission: KnowledgeFsQueryAdmissionResponse = {
      expires_at: '2026-07-28T12:00:00Z',
      operation_id: 'createQuery',
      request: {
        knowledgeSpaceId: 'space-1',
        mode: 'fast',
        query: 'What is the policy?',
      },
      token: `header.${btoa(JSON.stringify({ trace_id: 'capability-trace-1' }))}.signature`,
      url: 'https://query.example.test/stream',
    }

    await streamKnowledgeQuery({
      admission,
      onEvent: (event) => events.push(event),
    })

    expect(fetchMock).toHaveBeenCalledWith(
      admission.url,
      expect.objectContaining({
        body: JSON.stringify(admission.request),
        headers: expect.objectContaining({
          Accept: 'text/event-stream',
          Authorization: `Bearer ${admission.token}`,
          'X-Trace-ID': 'capability-trace-1',
        }),
        method: 'POST',
      }),
    )
    expect(events).toEqual([
      { data: { chunk: { id: 'chunk-1' } }, event: 'evidence', id: undefined },
      { data: { trace_id: 'trace-1' }, event: 'done', id: undefined },
    ])

    fetchMock.mockRestore()
  })
})
