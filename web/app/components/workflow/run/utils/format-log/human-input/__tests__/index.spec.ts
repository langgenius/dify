import type { NodeTracing } from '@/types/workflow'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import formatToTracingNodeList from '../../index'
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

    expect(formatHumanInputNode(list)).toEqual([list[2], list[1]])
  })

  it('returns the original list when there are no human-input nodes', () => {
    const list = [createNodeTracing()]

    expect(formatHumanInputNode(list)).toEqual(list)
  })

  it('merges statuses within an execution without discarding another approval', () => {
    const first = {
      ...createNodeTracing({
        node_type: BlockEnum.HumanInput,
        index: 1,
        status: NodeRunningStatus.Paused,
      }),
      node_execution_id: 'first-approval',
    }
    const second = {
      ...createNodeTracing({ id: 'trace-2', node_type: BlockEnum.HumanInput, index: 2 }),
      node_execution_id: 'second-approval',
    }
    const resumed = { ...first, id: 'trace-3', index: 3, status: NodeRunningStatus.Succeeded }

    expect(formatHumanInputNode([first, second, resumed])).toEqual([resumed, second])
  })

  it.each([BlockEnum.Loop, BlockEnum.Iteration])(
    'preserves every approval when grouping %s traces without an explicit execution ID',
    (containerType) => {
      const container = createNodeTracing({
        id: 'container-execution',
        node_id: 'container',
        node_type: containerType,
      })
      const approvals = [0, 1].map((index) =>
        createNodeTracing({
          id: `approval-${index}`,
          index: index + 1,
          node_type: BlockEnum.HumanInput,
          status: index ? NodeRunningStatus.Paused : NodeRunningStatus.Succeeded,
          execution_metadata: {
            total_tokens: 0,
            total_price: 0,
            currency: 'USD',
            [`${containerType}_id`]: container.node_id,
            [`${containerType}_index`]: index,
          },
        }),
      )

      const result = formatToTracingNodeList(
        [container, ...approvals],
        withSelectorKey((key: string) => key, 'workflow'),
      )

      expect(result[0]?.details?.map((row) => row.map((node) => node.id))).toEqual([
        ['approval-0'],
        ['approval-1'],
      ])
    },
  )
})
