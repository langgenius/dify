import { describe, expect, it } from 'vite-plus/test'
import {
  generatedOperationId,
  getTypedEventStreamOperations,
} from './scripts/api-contract-streaming-utils.mjs'

describe('API streaming contract generation', () => {
  it('detects typed pure SSE operations using the generated operation id', () => {
    expect(
      getTypedEventStreamOperations({
        paths: {
          '/dify-builder/sessions/{session_id}': {
            get: {
              'x-dify-typed-event-stream-response': 'DifyBuilderStreamEventResponse',
              responses: {
                200: { content: { 'text/event-stream': { schema: { $ref: '#/events' } } } },
                404: { content: { 'application/json': { schema: { $ref: '#/error' } } } },
              },
            },
          },
        },
      }),
    ).toEqual([
      {
        method: 'get',
        operationId: 'getDifyBuilderSessionsBySessionId',
        path: '/dify-builder/sessions/{session_id}',
      },
    ])
    expect(generatedOperationId('post', '/dify-builder/sessions/{session_id}/messages')).toBe(
      'postDifyBuilderSessionsBySessionIdMessages',
    )
  })

  it('does not rewrite untyped or mixed JSON/SSE operations', () => {
    expect(
      getTypedEventStreamOperations({
        paths: {
          '/untyped': {
            get: { responses: { 200: { content: { 'text/event-stream': {} } } } },
          },
          '/mixed': {
            post: {
              'x-dify-typed-event-stream-response': 'Event',
              responses: {
                200: { content: { 'application/json': {}, 'text/event-stream': {} } },
              },
            },
          },
        },
      }),
    ).toEqual([])
  })
})
