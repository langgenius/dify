import { act } from '@testing-library/react'
import { useReactFlow } from 'reactflow'
import { createLoopNode, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { LOOP_PADDING } from '@/app/components/workflow/constants'
import { BlockEnum } from '@/app/components/workflow/types'
import { useNodeLoopInteractions } from '../use-interactions'

const renderInteractions = (nodes: ReturnType<typeof createNode>[]) =>
  renderWorkflowFlowHook(
    () => ({
      ...useNodeLoopInteractions(),
      flow: useReactFlow(),
    }),
    { nodes },
  )

it('expands the parent when a child grows without changing unrelated nodes', () => {
  const standalone = createNode({ id: 'standalone', position: { x: 400, y: 0 } })
  const { result } = renderInteractions([
    createLoopNode({ id: 'loop', width: 120, height: 80, data: { width: 120, height: 80 } }),
    createNode({
      id: 'child',
      parentId: 'loop',
      position: { x: 100, y: 90 },
      width: 60,
      height: 40,
    }),
    standalone,
  ])
  act(() => result.current.handleNodeLoopChildSizeChange('child'))
  expect(result.current.flow.getNode('loop')).toMatchObject({
    width: 160 + LOOP_PADDING.right,
    height: 130 + LOOP_PADDING.bottom,
    data: { width: 160 + LOOP_PADDING.right, height: 130 + LOOP_PADDING.bottom },
  })
  act(() => result.current.handleNodeLoopChildSizeChange('standalone'))
  expect(result.current.flow.getNode('standalone')).toMatchObject(standalone)
})

it('restricts a dragged child to its actual loop container padding', () => {
  const { result } = renderInteractions([
    createLoopNode({ id: 'loop', width: 200, height: 180, data: { width: 200, height: 180 } }),
  ])
  const child = createNode({
    id: 'child',
    parentId: 'loop',
    position: { x: -10, y: -5 },
    width: 80,
    height: 60,
    data: { isInLoop: true },
  })
  expect(result.current.handleNodeLoopChildDrag(child).restrictPosition).toEqual({
    x: LOOP_PADDING.left,
    y: LOOP_PADDING.top,
  })
})

it('copies only the loop children and remaps their parent and node ids', () => {
  const child = createNode({
    id: 'child',
    parentId: 'loop',
    data: { type: BlockEnum.Code, title: 'Child' },
  })
  const { result } = renderInteractions([
    createLoopNode({ id: 'loop' }),
    child,
    createNode({ id: 'unrelated', data: { type: BlockEnum.Code, title: 'Code' } }),
  ])
  const copied = result.current.handleNodeLoopChildrenCopy('loop', 'new-loop', {
    existing: 'mapped',
  })
  expect(copied.copyChildren).toMatchObject([
    { parentId: 'new-loop', type: 'custom', data: { type: BlockEnum.Code, loop_id: 'new-loop' } },
  ])
  expect(copied.copyChildren[0]!.id).not.toBe('child')
  expect(copied.newIdMapping).toEqual({ existing: 'mapped', child: copied.copyChildren[0]!.id })
  expect(result.current.flow.getNode('child')).toMatchObject(child)
})
