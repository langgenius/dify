import type { NodeTracing } from '@/types/workflow'
import format from '..'

type ExecutionMetadata = NonNullable<NodeTracing['execution_metadata']>

const createExecutionMetadata = (
  overrides: Partial<ExecutionMetadata> = {},
): ExecutionMetadata => ({
  total_tokens: 0,
  total_price: 0,
  currency: 'USD',
  ...overrides,
})

const createTrace = (
  overrides: Omit<Partial<NodeTracing>, 'execution_metadata'> & {
    execution_metadata?: Partial<ExecutionMetadata>
  },
): NodeTracing => {
  const { execution_metadata, ...rest } = overrides

  return {
    node_id: 'node',
    status: 'succeeded',
    ...rest,
    execution_metadata: createExecutionMetadata(execution_metadata),
  } as NodeTracing
}

describe('retry format log', () => {
  it('should remove retry status nodes and attach them to the matching node', () => {
    const retryOne = createTrace({ node_id: 'code', status: 'retry' })
    const retryTwo = createTrace({ node_id: 'code', status: 'retry' })
    const finalRun = createTrace({ node_id: 'code', status: 'succeeded' })

    const result = format([retryOne, retryTwo, finalRun])

    expect(result).toEqual([
      expect.objectContaining({
        node_id: 'code',
        status: 'succeeded',
        retryDetail: [retryOne, retryTwo],
      }),
    ])
  })

  it('should match retry nodes by loop index inside loop runs', () => {
    const retryFromPreviousRun = createTrace({
      node_id: 'tool',
      status: 'retry',
      execution_metadata: {
        loop_id: 'loop',
        loop_index: 0,
      },
    })
    const retryFromCurrentRun = createTrace({
      node_id: 'tool',
      status: 'retry',
      execution_metadata: {
        loop_id: 'loop',
        loop_index: 1,
      },
    })
    const finalRun = createTrace({
      node_id: 'tool',
      status: 'succeeded',
      execution_metadata: {
        loop_id: 'loop',
        loop_index: 1,
      },
    })

    const result = format([retryFromPreviousRun, retryFromCurrentRun, finalRun])

    expect(result).toEqual([
      expect.objectContaining({
        retryDetail: [retryFromCurrentRun],
      }),
    ])
  })
})
