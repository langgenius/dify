import type { AgentLogItem, NodeTracing } from '@/types/workflow'
import {
  findTracingIndexByExecutionOrUniqueNodeId,
  mergeTracingNodePreservingExecutionMetadata,
  upsertTracingNodeOnResumeStart,
} from './tracing-execution'

const createTrace = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: 'llm' as NodeTracing['node_type'],
  title: 'Node 1',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs: {},
  outputs_truncated: false,
  status: 'succeeded' as NodeTracing['status'],
  elapsed_time: 0,
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
  finished_at: 0,
  ...overrides,
})

describe('tracing-execution utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should prefer the exact execution id when the same node ran multiple times', () => {
    const tracing = [
      createTrace({ id: 'trace-1', node_id: 'node-1' }),
      createTrace({ id: 'trace-2', node_id: 'node-1' }),
    ]

    expect(findTracingIndexByExecutionOrUniqueNodeId(tracing, {
      executionId: 'trace-2',
      nodeId: 'node-1',
    })).toBe(1)
  })

  it('should fall back to a unique node id when the execution id is missing', () => {
    const tracing = [
      createTrace({ id: 'trace-1', node_id: 'node-1' }),
    ]

    expect(findTracingIndexByExecutionOrUniqueNodeId(tracing, {
      executionId: 'missing-trace',
      nodeId: 'node-1',
    })).toBe(0)
  })

  it('should not fall back to node id when multiple executions exist', () => {
    const tracing = [
      createTrace({ id: 'trace-1', node_id: 'node-1' }),
      createTrace({ id: 'trace-2', node_id: 'node-1' }),
    ]

    expect(findTracingIndexByExecutionOrUniqueNodeId(tracing, {
      executionId: 'missing-trace',
      nodeId: 'node-1',
    })).toBe(-1)
  })

  it('should merge into an existing resume trace instead of appending a duplicate', () => {
    const tracing: NodeTracing[] = [
      createTrace({ id: 'trace-1', node_id: 'node-1', title: 'old title' }),
    ]

    upsertTracingNodeOnResumeStart(tracing, createTrace({ node_id: 'node-1', title: 'new title' }))

    expect(tracing).toHaveLength(1)
    expect(tracing[0].id).toBe('trace-1')
    expect(tracing[0].title).toBe('new title')
  })

  it('should append a new trace when a new execution id appears', () => {
    const tracing: NodeTracing[] = [
      createTrace({ id: 'trace-1', node_id: 'node-1' }),
    ]

    upsertTracingNodeOnResumeStart(tracing, createTrace({ id: 'trace-2', node_id: 'node-1', title: 'second run' }))

    expect(tracing).toHaveLength(2)
    expect(tracing[1].id).toBe('trace-2')
  })

  it('should preserve agent logs when merging finish metadata', () => {
    const agentLogItem: AgentLogItem = {
      node_execution_id: 'trace-1',
      message_id: 'm-1',
      node_id: 'node-1',
      label: 'tool',
      data: {},
      status: 'success',
    }

    const currentNode = createTrace({
      execution_metadata: {
        total_tokens: 1,
        total_price: 0,
        currency: 'USD',
        agent_log: [agentLogItem],
        parallel_id: 'p-1',
      },
    })

    const mergedNode = mergeTracingNodePreservingExecutionMetadata(currentNode, {
      status: 'succeeded' as NodeTracing['status'],
      execution_metadata: {
        total_tokens: 2,
        total_price: 1,
        currency: 'USD',
        parallel_id: 'p-1',
        extra: 'value',
      } as NodeTracing['execution_metadata'],
    })

    expect(mergedNode.execution_metadata?.agent_log).toEqual([agentLogItem])
    expect((mergedNode.execution_metadata as Record<string, unknown>).extra).toBe('value')
  })
})
