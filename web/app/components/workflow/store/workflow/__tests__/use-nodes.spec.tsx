import type { Node } from '../../../types'
import { renderWorkflowHook } from '../../../__tests__/workflow-test-env'
import { BlockEnum } from '../../../types'
import useWorkflowNodes from '../use-nodes'

describe('useWorkflowNodes', () => {
  it('reads nodes from the real workflow store context', () => {
    const nodes: Node[] = [
      {
        id: 'node-start',
        type: 'custom',
        position: { x: 0, y: 0 },
        data: {
          title: 'Start',
          desc: '',
          type: BlockEnum.Start,
        },
      },
    ]

    const { result } = renderWorkflowHook(() => useWorkflowNodes(), {
      initialStoreState: {
        nodes,
      },
    })

    expect(result.current).toEqual(nodes)
  })
})
