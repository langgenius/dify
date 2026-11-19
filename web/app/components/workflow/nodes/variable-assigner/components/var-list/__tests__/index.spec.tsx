import type { ComponentProps } from 'react'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderAssigner as renderWorkflowFlowComponent } from '../../../__tests__/test-helpers'
import VarList from '../index'

const sourceNode = createNode({
  id: 'node-a',
  data: {
    type: BlockEnum.Code,
    title: 'Source Node',
    outputs: {
      answer: { type: VarType.string },
      other: { type: VarType.string },
    },
  },
})

const currentNode = createNode({
  id: 'node-current',
  data: {
    type: BlockEnum.VariableAssigner,
    title: 'Variable Assigner',
  },
})

const renderVarList = (props: Partial<ComponentProps<typeof VarList>> = {}) => {
  const handleChange = vi.fn()
  const handleOpen = vi.fn()

  const result = renderWorkflowFlowComponent(
    <VarList
      readonly={false}
      nodeId="node-current"
      list={[]}
      onChange={handleChange}
      onOpen={handleOpen}
      {...props}
    />,
    {
      nodes: [sourceNode, currentNode],
      edges: [createEdge({ source: 'node-a', target: 'node-current' })],
      initialStoreState: { isWorkflowDataLoaded: true },
      hooksStoreProps: {},
    },
  )

  return {
    ...result,
    handleChange,
    handleOpen,
  }
}

describe('variable-assigner/var-list', () => {
  it('selects a replacement through the real picker and removes the assigned variable', async () => {
    const user = userEvent.setup()
    const { handleChange, handleOpen } = renderVarList({ list: [['node-a', 'other']] })
    await user.click(await screen.findByTestId('var-reference-picker-trigger'))
    expect(handleOpen).toHaveBeenCalledWith(0)
    const popup = await screen.findByRole('dialog')
    await user.click(await within(popup).findByText('answer'))
    expect(handleChange).toHaveBeenLastCalledWith([['node-a', 'answer']], ['node-a', 'answer'])
    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(handleChange).toHaveBeenLastCalledWith([])
  })
})
