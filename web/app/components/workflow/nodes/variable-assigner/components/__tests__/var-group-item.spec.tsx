import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { renderAssigner as renderWorkflowFlowComponent } from '../../__tests__/test-helpers'
import VarGroupItem from '../var-group-item'

it('normalizes spaces when renaming a variable group', async () => {
  const user = userEvent.setup()
  const onGroupNameChange = vi.fn()
  function Harness() {
    const [name, setName] = useState('Group_A')
    return (
      <VarGroupItem
        readOnly={false}
        nodeId="node-1"
        payload={{ group_name: name, output_type: VarType.any, variables: [] }}
        onChange={vi.fn()}
        groupEnabled
        availableVars={[]}
        onGroupNameChange={(next) => {
          setName(next)
          onGroupNameChange(next)
        }}
      />
    )
  }
  renderWorkflowFlowComponent(<Harness />, {
    nodes: [
      createNode({
        id: 'node-1',
        data: { type: BlockEnum.VariableAssigner, title: 'Variable Assigner' },
      }),
    ],
    edges: [],
    hooksStoreProps: {},
  })

  await user.click(screen.getByText('Group_A'))
  await user.type(screen.getByDisplayValue('Group_A'), ' renamed')
  await user.tab()
  expect(onGroupNameChange).toHaveBeenLastCalledWith('Group_A_renamed')
  expect(screen.getByText('Group_A_renamed')).toBeInTheDocument()
})
