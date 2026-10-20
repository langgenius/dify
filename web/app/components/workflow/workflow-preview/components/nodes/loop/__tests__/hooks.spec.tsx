import type { Node } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { createLoopNode, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { LOOP_PADDING } from '@/app/components/workflow/constants'
import { useNodeLoopInteractions } from '../hooks'

const renderInteractions = (nodes: Node[]) =>
  renderWorkflowCanvasHook(
    () => ({ interactions: useNodeLoopInteractions(), reactFlowStore: useStoreApi() }),
    { nodes },
  )

const getNode = (reactFlowStore: ReturnType<typeof useStoreApi>, nodeId: string) =>
  reactFlowStore
    .getState()
    .getNodes()
    .find((node) => node.id === nodeId)!

describe('workflow preview loop interactions', () => {
  it('uses the independently rightmost and bottommost children and leaves unrelated nodes unchanged', () => {
    const unrelatedNode = createNode({
      id: 'unrelated',
      position: { x: 1_000, y: 1_000 },
      width: 500,
      height: 500,
      data: { title: 'Outside the loop' },
    })
    const { result } = renderInteractions([
      createLoopNode({
        id: 'loop-node',
        width: 120,
        height: 80,
        data: { width: 120, height: 80 },
      }),
      createNode({
        id: 'rightmost-child',
        parentId: 'loop-node',
        position: { x: 200, y: 10 },
        width: 30,
        height: 20,
      }),
      createNode({
        id: 'bottommost-child',
        parentId: 'loop-node',
        position: { x: 10, y: 160 },
        width: 20,
        height: 50,
      }),
      unrelatedNode,
    ])

    act(() => result.current.interactions.handleNodeLoopRerender('loop-node'))

    const loopNode = getNode(result.current.reactFlowStore, 'loop-node')
    const expectedWidth = 200 + 30 + LOOP_PADDING.right
    const expectedHeight = 160 + 50 + LOOP_PADDING.bottom
    expect(loopNode).toMatchObject({ width: expectedWidth, height: expectedHeight })
    expect(loopNode.data).toMatchObject({ width: expectedWidth, height: expectedHeight })
    expect(getNode(result.current.reactFlowStore, 'unrelated')).toMatchObject(unrelatedNode)
  })

  it.each([
    {
      dimension: 'width only',
      loopSize: { width: 100, height: 300 },
      child: { position: { x: 100, y: 10 }, width: 50, height: 20 },
      expected: { width: 150 + LOOP_PADDING.right, height: 300 },
    },
    {
      dimension: 'height only',
      loopSize: { width: 300, height: 100 },
      child: { position: { x: 10, y: 100 }, width: 20, height: 50 },
      expected: { width: 300, height: 150 + LOOP_PADDING.bottom },
    },
  ])('expands $dimension without changing the other dimension', ({ loopSize, child, expected }) => {
    const { result } = renderInteractions([
      createLoopNode({ id: 'loop-node', ...loopSize, data: loopSize }),
      createNode({ id: 'child-node', parentId: 'loop-node', ...child }),
    ])

    act(() => result.current.interactions.handleNodeLoopRerender('loop-node'))

    const loopNode = getNode(result.current.reactFlowStore, 'loop-node')
    expect(loopNode).toMatchObject(expected)
    expect(loopNode.data).toMatchObject(expected)
  })

  it.each([
    {
      scenario: 'children fit',
      children: [
        createNode({
          id: 'child-node',
          parentId: 'loop-node',
          position: { x: 20, y: 20 },
          width: 40,
          height: 40,
        }),
      ],
    },
    { scenario: 'there are no children', children: [] },
  ])('does not shrink the loop when $scenario', ({ children }) => {
    const loopNode = createLoopNode({
      id: 'loop-node',
      width: 300,
      height: 240,
      data: { width: 300, height: 240 },
    })
    const { result } = renderInteractions([loopNode, ...children])

    act(() => result.current.interactions.handleNodeLoopRerender('loop-node'))

    expect(getNode(result.current.reactFlowStore, 'loop-node')).toMatchObject({
      width: 300,
      height: 240,
      data: { width: 300, height: 240 },
    })
  })
})
