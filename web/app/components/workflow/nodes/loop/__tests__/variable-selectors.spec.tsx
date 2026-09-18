import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { VarType as NumberVarType } from '@/app/components/workflow/nodes/tool/types'
import { VarType } from '@/app/components/workflow/types'
import ConditionAdd from '../components/condition-add'
import ConditionVarSelector from '../components/condition-list/condition-var-selector'
import ConditionNumberInput from '../components/condition-number-input'

const answer = { variable: 'answer', type: VarType.number }
const variables: NodeOutPutVar[] = [{ nodeId: 'source', title: 'Source', vars: [answer] }]

it('adds the variable selected through the search and closes the add popup', async () => {
  const user = userEvent.setup()
  const onSelectVariable = vi.fn()
  render(<ConditionAdd variables={variables} onSelectVariable={onSelectVariable} />)
  await user.click(screen.getByRole('button', { name: 'workflow.nodes.ifElse.addCondition' }))
  const search = screen.getByRole('searchbox')
  await user.type(search, 'answer{Enter}')
  expect(onSelectVariable).toHaveBeenCalledWith(['source', 'answer'], answer)
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
})

it('writes a variable expression when selecting a numeric comparison value', async () => {
  const user = userEvent.setup()
  const onValueChange = vi.fn()
  render(
    <ConditionNumberInput
      numberVarType={NumberVarType.variable}
      value=""
      variables={variables}
      onNumberVarTypeChange={vi.fn()}
      onValueChange={onValueChange}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'workflow.nodes.ifElse.selectVariable' }))
  await user.type(screen.getByRole('searchbox'), 'answer{Enter}')
  expect(onValueChange).toHaveBeenCalledWith('{{#source.answer#}}')
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
})

it('updates the selected condition variable through its controlled popup', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function ConditionHarness() {
    const [open, setOpen] = useState(false)
    return (
      <ConditionVarSelector
        open={open}
        onOpenChange={setOpen}
        valueSelector={['source', 'previous']}
        varType={VarType.number}
        availableNodes={[]}
        nodesOutputVars={variables}
        onChange={onChange}
      />
    )
  }
  render(
    <ReactFlowProvider>
      <ConditionHarness />
    </ReactFlowProvider>,
  )
  await user.click(screen.getByText('previous'))
  await user.type(screen.getByRole('searchbox'), 'answer{Enter}')
  expect(onChange).toHaveBeenCalledWith(['source', 'answer'], answer)
})
