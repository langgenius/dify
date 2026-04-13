import type { NodeTracing } from '@/types/workflow'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import formatHumanInputNode from '../index'

const createNodeTracing = (overrides: Partial<NodeTracing> = {}): NodeTracing => ({
  id: 'trace-1',
  index: 0,
  predecessor_node_id: '',
  node_id: 'node-1',
  node_type: BlockEnum.Code,
  title: 'Code Node',
  inputs: {},
  inputs_truncated: false,
  process_data: {},
  process_data_truncated: false,
  outputs_truncated: false,
  status: NodeRunningStatus.Succeeded,
  elapsed_time: 0,
  execution_metadata: {
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
    name: 'Alice',
    email: 'alice@example.com',
  },
  finished_at: 0,
  ...overrides,
})

describe('formatHumanInputNode', () => {
  it('keeps only the latest human-input log for each node and preserves other logs', () => {
    const list = [
      createNodeTracing({
        id: 'trace-1',
        index: 1,
        node_id: 'human-1',
        node_type: BlockEnum.HumanInput,
        title: 'Human Input',
      }),
      createNodeTracing({
        id: 'trace-2',
        index: 2,
        node_id: 'code-1',
      }),
      createNodeTracing({
        id: 'trace-3',
        index: 3,
        node_id: 'human-1',
        node_type: BlockEnum.HumanInput,
        title: 'Human Input Latest',
      }),
    ]

    expect(formatHumanInputNode(list)).toEqual([
      list[2],
      list[1],
    ])
  })

  it('returns the original list when there are no human-input nodes', () => {
    const list = [createNodeTracing()]

    expect(formatHumanInputNode(list)).toEqual(list)
  })
})
