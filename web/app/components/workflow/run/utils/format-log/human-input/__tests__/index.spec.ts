import type { WorkflowTranslate } from '../../parallel'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, NodeRunningStatus } from '@/app/components/workflow/types'
import { withSelectorKey } from '@/test/i18n-mock'
import formatToTracingNodeList from '../../index'
import formatHumanInputNode from '../index'

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
      createNodeTracing({
        id: 'late-arriving-older-status',
        index: 2,
        node_id: 'human-1',
        node_type: BlockEnum.HumanInput,
      }),
    ]

    expect(formatHumanInputNode(list)).toEqual([list[2], list[1]])
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
      ...createNodeTracing({
        id: 'trace-2',
        node_type: BlockEnum.HumanInput,
        index: 2,
        status: NodeRunningStatus.Succeeded,
      }),
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
        withSelectorKey((key: string) => key, 'workflow') as WorkflowTranslate,
      )

      expect(result[0]?.details?.map((row) => row.map((node) => node.id))).toEqual([
        ['approval-0'],
        ['approval-1'],
      ])
    },
  )
})
