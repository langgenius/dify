import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getStreamingOperationIds } from './scripts/knowledge-fs-contract-utils.mjs'

describe('KnowledgeFS contract generation', () => {
  for (const status of ['200', '2XX']) {
    it(`detects an SSE response declared with ${status}`, () => {
      assert.deepEqual(
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
        ['streamTaskEvents'],
      )
    })
  }
})
