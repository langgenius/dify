import { describe, expect, it } from 'vitest'
import { getStreamingOperationIds } from './scripts/knowledge-fs-contract-utils.mjs'

describe('KnowledgeFS contract generation', () => {
  it.each(['200', '2XX'])('detects an SSE response declared with %s', (status) => {
    expect(
      getStreamingOperationIds({
        paths: {
          '/tasks/{id}/events': {
            get: {
              operationId: 'streamTaskEvents',
              responses: {
                [status]: {
                  content: {
                    'text/event-stream': {},
                  },
                },
              },
            },
          },
        },
      }),
    ).toEqual(['streamTaskEvents'])
  })
})
