import type { NodeTracing } from '@/types/workflow'
import { addChildrenToLoopNode } from '..'

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

describe('loop format log', () => {
  it('should place the first child of a new loop at a new record when its index is missing', () => {
    const parent = createTrace('loop')
    const child = createTrace('code', { loop_id: 'loop', loop_index: 0 })
    const streamingChild = createTrace('code', { loop_id: 'loop' })

    const result = addChildrenToLoopNode(parent, [child, streamingChild])

    expect(result.details).toEqual([[child], [streamingChild]])
  })

  it('should keep missing loop index items in the current record when the node has not restarted', () => {
    const parent = createTrace('loop')
    const firstRunChild = createTrace('code', { loop_id: 'loop', loop_index: 0 })
    const secondRunChild = createTrace('code', { loop_id: 'loop', loop_index: 1 })
    const streamingChild = createTrace('tool', { loop_id: 'loop' })

    const result = addChildrenToLoopNode(parent, [firstRunChild, secondRunChild, streamingChild])

    expect(result.details).toEqual([[firstRunChild], [secondRunChild, streamingChild]])
  })

  it('should group loop children by parallel run id before loop index', () => {
    const parent = createTrace('loop')
    const firstParallelChild = createTrace('code', {
      loop_id: 'loop',
      loop_index: 0,
      parallel_mode_run_id: 'parallel-a',
    })
    const secondParallelChild = createTrace('tool', {
      loop_id: 'loop',
      loop_index: 0,
      parallel_mode_run_id: 'parallel-b',
    })

    const result = addChildrenToLoopNode(parent, [firstParallelChild, secondParallelChild])

    expect(result.details).toEqual([[firstParallelChild], [secondParallelChild]])
  })
})
