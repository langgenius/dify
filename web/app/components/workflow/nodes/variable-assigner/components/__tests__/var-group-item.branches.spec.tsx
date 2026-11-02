import type { VarGroupItem as Payload } from '../../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderAssigner as renderWorkflowFlowComponent } from '../../__tests__/test-helpers'
import VarGroupItem from '../var-group-item'

const source = createNode({
  id: 'source',
  data: {
    type: BlockEnum.Code,
    title: 'Source',
    outputs: {
      answer: { type: VarType.string },
      alternate: { type: VarType.string },
      flag: { type: VarType.boolean },
    },
  },
})
const availableVars = [
  {
    nodeId: 'source',
    title: 'Source',
    vars: [
      { variable: 'answer', type: VarType.string },
      { variable: 'alternate', type: VarType.string },
      { variable: 'flag', type: VarType.boolean },
    ],
  },
]
const renderGroup = () => {
  const onChange = vi.fn()
  function Harness() {
    const [payload, setPayload] = useState<Payload>({ output_type: VarType.any, variables: [] })
    return (
      <VarGroupItem
        readOnly={false}
        nodeId="group"
        payload={payload}
        groupEnabled={false}
        availableVars={availableVars}
        onChange={(next) => {
          setPayload(next)
          onChange(next)
        }}
      />
    )
  }
  const result = renderWorkflowFlowComponent(<Harness />, {
    nodes: [source, createNode({ id: 'group', data: { type: BlockEnum.VariableAssigner } })],
    edges: [createEdge({ source: 'source', target: 'group' })],
  })
  return { ...result, onChange }
}

it('fixes the group type after adding a variable, rejects duplicates, and resets it after removing the last value', async () => {
  const user = userEvent.setup()
  const { onChange } = renderGroup()
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  expect(await screen.findByText('flag')).toBeVisible()
  await user.click(screen.getByText('answer'))
  expect(onChange).toHaveBeenLastCalledWith({
    output_type: VarType.string,
    variables: [['source', 'answer']],
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  const search = screen.getByRole('searchbox')
  await user.type(search, 'answer')
  await user.click(screen.getAllByText('answer').at(-1)!)
  expect(onChange).toHaveBeenCalledTimes(1)
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(onChange).toHaveBeenLastCalledWith({ output_type: VarType.any, variables: [] })
  expect(screen.getByText('workflowLogic.nodes.variableAssigner.noVarTip')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'common.operation.add' }))
  expect(await screen.findByText('flag')).toBeVisible()
})
