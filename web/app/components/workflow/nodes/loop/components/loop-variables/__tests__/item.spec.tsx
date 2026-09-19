import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ValueType, VarType } from '@/app/components/workflow/types'
import Item from '../item'

vi.mock('../form-item', () => ({
  default: () => <div />,
}))

vi.mock('../input-mode-selec', () => ({
  default: () => <div />,
}))

vi.mock('../variable-type-select', () => ({
  default: () => <div />,
}))

describe('Loop variable item', () => {
  it('normalizes the variable name through its labeled input', () => {
    const handleUpdateLoopVariable = vi.fn()

    render(
      <Item
        nodeId="loop-node"
        item={{
          id: 'loop-variable',
          label: 'item',
          var_type: VarType.string,
          value_type: ValueType.constant,
          value: '',
        }}
        handleRemoveLoopVariable={vi.fn()}
        handleUpdateLoopVariable={handleUpdateLoopVariable}
      />,
    )

    fireEvent.change(screen.getByRole('textbox', { name: 'workflow.nodes.loop.variableName' }), {
      target: { value: 'new name' },
    })

    expect(handleUpdateLoopVariable).toHaveBeenCalledWith('loop-variable', { label: 'new_name' })
  })

  it('removes the current variable from its named icon command', async () => {
    const user = userEvent.setup()
    const handleRemoveLoopVariable = vi.fn()

    render(
      <Item
        nodeId="loop-node"
        item={{
          id: 'loop-variable',
          label: 'item',
          var_type: VarType.string,
          value_type: ValueType.constant,
          value: '',
        }}
        handleRemoveLoopVariable={handleRemoveLoopVariable}
        handleUpdateLoopVariable={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))

    expect(handleRemoveLoopVariable).toHaveBeenCalledWith('loop-variable')
  })
})
