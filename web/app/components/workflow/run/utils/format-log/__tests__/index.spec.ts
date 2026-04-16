import type { NodeTracing } from '@/types/workflow'
import { BlockEnum } from '@/app/components/workflow/types'

import formatToTracingNodeList from '../index'

const mockFormatAgentNode = vi.hoisted(() => vi.fn())
const mockFormatHumanInputNode = vi.hoisted(() => vi.fn())
const mockFormatRetryNode = vi.hoisted(() => vi.fn())
const mockAddChildrenToLoopNode = vi.hoisted(() => vi.fn())
const mockAddChildrenToIterationNode = vi.hoisted(() => vi.fn())
const mockFormatParallelNode = vi.hoisted(() => vi.fn())

vi.mock('../agent', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatAgentNode(...args),
}))

vi.mock('../human-input', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatHumanInputNode(...args),
}))

vi.mock('../retry', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatRetryNode(...args),
}))

vi.mock('../loop', () => ({
  addChildrenToLoopNode: (...args: unknown[]) => mockAddChildrenToLoopNode(...args),
}))

vi.mock('../iteration', () => ({
  addChildrenToIterationNode: (...args: unknown[]) => mockAddChildrenToIterationNode(...args),
}))

vi.mock('../parallel', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFormatParallelNode(...args),
}))

const createTrace = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: overrides.id ?? overrides.node_id ?? 'node-1',
  index: overrides.index ?? 0,
  predecessor_node_id: '',
  node_id: overrides.node_id ?? 'node-1',
  node_type: overrides.node_type ?? BlockEnum.Tool,
  title: overrides.title ?? 'Node',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: overrides.status ?? 'succeeded',
  error: overrides.error,
  elapsed_time: 1,
  execution_metadata: overrides.execution_metadata ?? {
    total_tokens: 0,
    total_price: 0,
    currency: 'USD',
  },
  metadata: {
    iterator_length: 0,
    iterator_index: 0,
    loop_length: 0,
    loop_index: 0,
  },
  created_at: 0,
  created_by: {
    id: 'user-1',
    name: 'User',
    email: 'user@example.com',
  },
  finished_at: 1,
})

const createExecutionMetadata = (overrides: Partial<NonNullable<NodeTracing['execution_metadata']>> = {}): NonNullable<NodeTracing['execution_metadata']> => ({
  total_tokens: 0,
  total_price: 0,
  currency: 'USD',
  ...overrides,
})

describe('formatToTracingNodeList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFormatAgentNode.mockImplementation((list: NodeTracing[]) => list)
    mockFormatHumanInputNode.mockImplementation((list: NodeTracing[]) => list)
    mockFormatRetryNode.mockImplementation((list: NodeTracing[]) => list)
    mockAddChildrenToLoopNode.mockImplementation((item: NodeTracing, children: NodeTracing[]) => ({
      ...item,
      loopChildren: children.map(child => child.node_id),
      details: [[{ id: 'loop-detail-row' }]],
    }))
    mockAddChildrenToIterationNode.mockImplementation((item: NodeTracing, children: NodeTracing[]) => ({
      ...item,
      iterationChildren: children.map(child => child.node_id),
      details: [[{ id: 'iteration-detail-row' }]],
    }))
    mockFormatParallelNode.mockImplementation((list: unknown[]) =>
      list.map(item => ({
        ...(item as Record<string, unknown>),
        parallelFormatted: true,
      })))
  })

  it('should sort the input by index and run the formatter pipeline in order', () => {
    const t = vi.fn((key: string) => key)
    const traces = [
      createTrace({ id: 'b', node_id: 'b', title: 'B', index: 2 }),
      createTrace({ id: 'a', node_id: 'a', title: 'A', index: 0 }),
      createTrace({ id: 'c', node_id: 'c', title: 'C', index: 1 }),
    ]

    const result = formatToTracingNodeList(traces, t)

    expect(mockFormatAgentNode).toHaveBeenCalledWith([
      expect.objectContaining({ node_id: 'a' }),
      expect.objectContaining({ node_id: 'c' }),
      expect.objectContaining({ node_id: 'b' }),
    ])
    expect(mockFormatHumanInputNode).toHaveBeenCalledWith(mockFormatAgentNode.mock.results[0].value)
    expect(mockFormatRetryNode).toHaveBeenCalledWith(mockFormatHumanInputNode.mock.results[0].value)
    expect(mockFormatParallelNode).toHaveBeenLastCalledWith(expect.any(Array), t)
    expect(result).toEqual([
      expect.objectContaining({ node_id: 'a', parallelFormatted: true }),
      expect.objectContaining({ node_id: 'c', parallelFormatted: true }),
      expect.objectContaining({ node_id: 'b', parallelFormatted: true }),
    ])
  })

  it('should collapse loop and iteration children into parent nodes and propagate child failures', () => {
    const t = vi.fn((key: string) => key)
    const loopParent = createTrace({
      id: 'loop-parent',
      node_id: 'loop-parent',
      node_type: BlockEnum.Loop,
      index: 0,
    })
    const loopChild = createTrace({
      id: 'loop-child',
      node_id: 'loop-child',
      index: 1,
      status: 'failed',
      error: 'loop child failed',
      execution_metadata: createExecutionMetadata({ loop_id: 'loop-parent' }),
    })
    const iterationParent = createTrace({
      id: 'iteration-parent',
      node_id: 'iteration-parent',
      node_type: BlockEnum.Iteration,
      index: 2,
    })
    const iterationChild = createTrace({
      id: 'iteration-child',
      node_id: 'iteration-child',
      index: 3,
      status: 'failed',
      error: 'iteration child failed',
      execution_metadata: createExecutionMetadata({ iteration_id: 'iteration-parent' }),
    })

    const result = formatToTracingNodeList([
      loopParent,
      loopChild,
      iterationParent,
      iterationChild,
    ], t)

    expect(mockAddChildrenToLoopNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: 'loop-parent',
        status: 'failed',
        error: 'loop child failed',
      }),
      [expect.objectContaining({ node_id: 'loop-child' })],
    )
    expect(mockAddChildrenToIterationNode).toHaveBeenCalledWith(
      expect.objectContaining({
        node_id: 'iteration-parent',
        status: 'failed',
        error: 'iteration child failed',
      }),
      [expect.objectContaining({ node_id: 'iteration-child' })],
    )
    expect(mockFormatParallelNode).toHaveBeenCalledTimes(3)
    expect(result).toEqual([
      expect.objectContaining({
        node_id: 'loop-parent',
        loopChildren: ['loop-child'],
        parallelFormatted: true,
      }),
      expect.objectContaining({
        node_id: 'iteration-parent',
        iterationChildren: ['iteration-child'],
        parallelFormatted: true,
      }),
    ])
  })
})
