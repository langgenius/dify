import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
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
})
