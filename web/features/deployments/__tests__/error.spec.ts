import { describe, expect, it } from 'vitest'
import {
  APP_DEPLOY_UNSUPPORTED_DSL_NODE_TYPE,
  deploymentErrorMessage,
  unsupportedDslNodeError,
} from '../error'

function deploymentErrorResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: {
      'content-type': 'application/json',
    },
  })
}

describe('deployment error helpers', () => {
  describe('Unsupported DSL node errors', () => {
    it('should parse unsupported nodes from response metadata', async () => {
      const response = deploymentErrorResponse({
        message: 'unsupported dsl node type',
        reason: APP_DEPLOY_UNSUPPORTED_DSL_NODE_TYPE,
        metadata: {
          unsupported_nodes: JSON.stringify([
            { id: 'node-1', type: 'knowledge-retrieval' },
            { id: 'node-1', type: 'knowledge-retrieval' },
            { id: 'node-2', type: 'question-classifier' },
            { id: '', type: '' },
          ]),
        },
      })

      const result = await unsupportedDslNodeError(response)

      expect(result).toEqual({
        message: 'unsupported dsl node type (APPDEPLOY_UNSUPPORTED_DSL_NODE_TYPE)',
        nodes: [
          { id: 'node-1', type: 'knowledge-retrieval' },
          { id: 'node-2', type: 'question-classifier' },
        ],
      })
      await expect(deploymentErrorMessage(response)).resolves.toBe('unsupported dsl node type (APPDEPLOY_UNSUPPORTED_DSL_NODE_TYPE)')
    })

    it('should ignore deployment errors with a different reason', async () => {
      const response = deploymentErrorResponse({
        message: 'failed to create release',
        reason: 'APPDEPLOY_RELEASE_CREATE_FAILED',
        metadata: {
          unsupported_nodes: JSON.stringify([{ id: 'node-1', type: 'knowledge-retrieval' }]),
        },
      })

      await expect(unsupportedDslNodeError(response)).resolves.toBeUndefined()
    })
  })
})
