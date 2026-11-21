import type { CommonNodeType } from '@/app/components/workflow/types'
import { act } from '@testing-library/react'
import { useStoreApi } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowCanvasHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import useNodeCrud from '../use-node-crud'

type TestNodeData = CommonNodeType<{ value: string }>
const createData = (value = 'initial'): TestNodeData => ({
  type: BlockEnum.LLM,
  title: 'Test Node',
  desc: '',
  value,
})

it('saves edits to the current node after switching the editor to another node', () => {
  const { result, rerender } = renderWorkflowCanvasHook(
    ({ id, data }) => ({
      ...useNodeCrud(id, data),
      flow: useStoreApi(),
    }),
    {
      initialProps: { id: 'node-1', data: createData() },
      nodes: [
        createNode({ id: 'node-1', data: createData() }),
        createNode({ id: 'node-2', data: createData() }),
      ],
    },
  )

  act(() => result.current.setInputs(createData('changed')))
  expect(
    result.current.flow
      .getState()
      .getNodes()
      .map((node) => [node.id, node.data.value]),
  ).toEqual([
    ['node-1', 'changed'],
    ['node-2', 'initial'],
  ])

  rerender({ id: 'node-2', data: createData() })
  act(() => result.current.setInputs(createData('latest')))
  expect(
    result.current.flow
      .getState()
      .getNodes()
      .map((node) => [node.id, node.data.value]),
  ).toEqual([
    ['node-1', 'changed'],
    ['node-2', 'latest'],
  ])
})
