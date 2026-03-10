import type { NodeTracing } from '@/types/workflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { upsertTopLevelTracingNodeOnStart } from './top-level-tracing'

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
  status: NodeRunningStatus.Succeeded,
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

describe('upsertTopLevelTracingNodeOnStart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should append a new top-level node when no matching trace exists', () => {
    const tracing: NodeTracing[] = []
    const startedNode = createTrace({
      id: 'trace-2',
      node_id: 'node-2',
      status: NodeRunningStatus.Running,
    })

    const updated = upsertTopLevelTracingNodeOnStart(tracing, startedNode)

    expect(updated).toBe(true)
    expect(tracing).toEqual([startedNode])
  })

  it('should update an existing top-level node when the execution id matches', () => {
    const tracing: NodeTracing[] = [
      createTrace({
        id: 'trace-1',
        node_id: 'node-1',
        status: NodeRunningStatus.Succeeded,
      }),
    ]
    const startedNode = createTrace({
      id: 'trace-1',
      node_id: 'node-1',
      status: NodeRunningStatus.Running,
    })

    const updated = upsertTopLevelTracingNodeOnStart(tracing, startedNode)

    expect(updated).toBe(true)
    expect(tracing).toEqual([startedNode])
  })

  it('should append a new top-level node when the same node starts with a new execution id', () => {
    const existingTrace = createTrace({
      id: 'trace-1',
      node_id: 'node-1',
      status: NodeRunningStatus.Succeeded,
    })
    const tracing: NodeTracing[] = [existingTrace]
    const startedNode = createTrace({
      id: 'trace-2',
      node_id: 'node-1',
      status: NodeRunningStatus.Running,
    })

    const updated = upsertTopLevelTracingNodeOnStart(tracing, startedNode)

    expect(updated).toBe(true)
    expect(tracing).toEqual([existingTrace, startedNode])
  })

  it('should ignore nested iteration node starts even when the node id matches a top-level trace', () => {
    const existingTrace = createTrace({
      id: 'top-level-trace',
      node_id: 'node-1',
      status: NodeRunningStatus.Succeeded,
    })
    const tracing: NodeTracing[] = [existingTrace]
    const nestedIterationTrace = createTrace({
      id: 'iteration-trace',
      node_id: 'node-1',
      iteration_id: 'iteration-1',
      status: NodeRunningStatus.Running,
    })

    const updated = upsertTopLevelTracingNodeOnStart(tracing, nestedIterationTrace)

    expect(updated).toBe(false)
    expect(tracing).toEqual([existingTrace])
  })

  it('should ignore nested loop node starts even when the node id matches a top-level trace', () => {
    const existingTrace = createTrace({
      id: 'top-level-trace',
      node_id: 'node-1',
      status: NodeRunningStatus.Succeeded,
    })
    const tracing: NodeTracing[] = [existingTrace]
    const nestedLoopTrace = createTrace({
      id: 'loop-trace',
      node_id: 'node-1',
      loop_id: 'loop-1',
      status: NodeRunningStatus.Running,
    })

    const updated = upsertTopLevelTracingNodeOnStart(tracing, nestedLoopTrace)

    expect(updated).toBe(false)
    expect(tracing).toEqual([existingTrace])
  })
})
