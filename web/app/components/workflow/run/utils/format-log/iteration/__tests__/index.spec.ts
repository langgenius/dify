import type { NodeTracing } from '@/types/workflow'
import { addChildrenToIterationNode } from '..'

type ExecutionMetadata = NonNullable<NodeTracing['execution_metadata']>

const createExecutionMetadata = (
  overrides: Partial<ExecutionMetadata> = {},
): ExecutionMetadata => ({
  total_tokens: 0,
  total_price: 0,
  currency: 'USD',
  ...overrides,
})

const createTrace = (nodeId: string, executionMetadata?: Partial<ExecutionMetadata>): NodeTracing =>
  ({
    node_id: nodeId,
    execution_metadata: createExecutionMetadata(executionMetadata),
  }) as NodeTracing

describe('iteration format log', () => {
  it('should place the first child of a new iteration at a new record when its index is missing', () => {
    const parent = createTrace('iteration')
    const child = createTrace('code', { iteration_id: 'iteration', iteration_index: 0 })
    const streamingChild = createTrace('code', { iteration_id: 'iteration' })

    const result = addChildrenToIterationNode(parent, [child, streamingChild])

    expect(result.details).toEqual([[child], [streamingChild]])
  })

  it('should keep missing iteration index items in the current record when the node has not restarted', () => {
    const parent = createTrace('iteration')
    const firstRunChild = createTrace('code', { iteration_id: 'iteration', iteration_index: 0 })
    const secondRunChild = createTrace('code', { iteration_id: 'iteration', iteration_index: 1 })
    const streamingChild = createTrace('tool', { iteration_id: 'iteration' })

    const result = addChildrenToIterationNode(parent, [
      firstRunChild,
      secondRunChild,
      streamingChild,
    ])

    expect(result.details).toEqual([[firstRunChild], [secondRunChild, streamingChild]])
  })

  it('should not move an earlier missing iteration index item into the latest record', () => {
    const parent = createTrace('iteration')
    const firstRunChild = createTrace('code', { iteration_id: 'iteration', iteration_index: 0 })
    const streamingChild = createTrace('tool', { iteration_id: 'iteration' })
    const secondRunChild = createTrace('code', { iteration_id: 'iteration', iteration_index: 1 })

    const result = addChildrenToIterationNode(parent, [
      firstRunChild,
      streamingChild,
      secondRunChild,
    ])

    expect(result.details).toEqual([[firstRunChild, streamingChild], [secondRunChild]])
  })
})
