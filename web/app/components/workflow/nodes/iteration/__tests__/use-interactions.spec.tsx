import type { Node } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { createIterationNode, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ITERATION_PADDING } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { useNodeIterationInteractions } from '../use-interactions'

vi.mock('../../../hooks/use-nodes-meta-data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/use-nodes-meta-data')>()

  return {
    ...actual,
    useNodesMetaData: () => ({
      nodesMap: {
        [BlockEnum.Code]: {
          defaultValue: {
            title: 'Code',
            desc: '',
          },
        },
      },
    }),
  }
})

const renderInteractions = (nodes: Node[]) =>
  renderWorkflowFlowHook(
    () => ({
      ...useNodeIterationInteractions(),
      flow: useReactFlow(),
    }),
    { nodes },
  )

describe('useNodeIterationInteractions', () => {
  it('should restrict dragging to the iteration container padding', () => {
    const { result } = renderInteractions([
      createIterationNode({
        id: 'iteration-node',
        width: 200,
        height: 180,
        data: { width: 200, height: 180 },
      }),
    ])

    const dragResult = result.current.handleNodeIterationChildDrag(
      createNode({
        id: 'child-node',
        parentId: 'iteration-node',
        position: { x: -10, y: -5 },
        width: 80,
        height: 60,
        data: { type: BlockEnum.Code, title: 'Child', desc: '', isInIteration: true },
      }),
    )

    expect(dragResult.restrictPosition).toEqual({
      x: ITERATION_PADDING.left,
      y: ITERATION_PADDING.top,
    })
  })

  it('should rerender the parent iteration node when a child size changes', () => {
    const { result } = renderInteractions([
      createIterationNode({
        id: 'iteration-node',
        width: 120,
        height: 80,
        data: { width: 120, height: 80 },
      }),
      createNode({
        id: 'child-node',
        parentId: 'iteration-node',
        position: { x: 100, y: 90 },
        width: 60,
        height: 40,
      }),
    ])

    act(() => result.current.handleNodeIterationChildSizeChange('child-node'))
    expect(result.current.flow.getNode('iteration-node')).toMatchObject({
      width: 160 + ITERATION_PADDING.right,
      height: 130 + ITERATION_PADDING.bottom,
      data: { width: 160 + ITERATION_PADDING.right, height: 130 + ITERATION_PADDING.bottom },
    })
  })

  it('should skip iteration rerender when the resized node has no parent', () => {
    const { result } = renderInteractions([
      createNode({
        id: 'standalone-node',
        data: { type: BlockEnum.Code, title: 'Standalone', desc: '' },
      }),
    ])

    const before = result.current.flow.getNodes()
    act(() => result.current.handleNodeIterationChildSizeChange('standalone-node'))
    expect(result.current.flow.getNodes()).toEqual(before)
  })

  it('should copy iteration children and remap ids', () => {
    const { result } = renderInteractions([
      createIterationNode({ id: 'iteration-node' }),
      createNode({
        id: 'child-node',
        parentId: 'iteration-node',
        data: { type: BlockEnum.Code, title: 'Child', desc: '' },
      }),
      createNode({
        id: 'same-type-node',
        data: { type: BlockEnum.Code, title: 'Code', desc: '' },
      }),
    ])
    const copyResult = result.current.handleNodeIterationChildrenCopy(
      'iteration-node',
      'new-iteration',
      { existing: 'mapped' },
    )

    expect(copyResult.copyChildren).toMatchObject([
      {
        parentId: 'new-iteration',
        type: 'custom',
        data: { type: BlockEnum.Code, iteration_id: 'new-iteration' },
      },
    ])
    expect(copyResult.copyChildren[0]!.id).not.toBe('child-node')
    expect(copyResult.newIdMapping).toEqual({
      existing: 'mapped',
      'child-node': copyResult.copyChildren[0]!.id,
    })
  })
})
