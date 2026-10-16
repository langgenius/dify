import type { LoopVariable } from '@/app/components/workflow/nodes/loop/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ValueType, VarType } from '@/app/components/workflow/types'
import FormItem from '../form-item'

describe('Loop variable constant input', () => {
  it('reports numeric edits and clearing as strings to the loop draft', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function LoopDraft() {
      const [value, setValue] = useState('12')
      return (
        <FormItem
          nodeId="loop-node"
          item={{
            id: 'count',
            label: 'count',
            var_type: VarType.number,
            value_type: ValueType.constant,
            value,
          }}
          onChange={(nextValue) => {
            setValue(nextValue)
            onChange(nextValue)
          }}
        />
      )
    }
    render(<LoopDraft />)

    const input = screen.getByRole('spinbutton', { name: 'count' })
    await user.clear(input)
    expect(onChange).toHaveBeenLastCalledWith('')
    await user.type(input, '-3.5')
    expect(input).toHaveValue(-3.5)
    expect(onChange).toHaveBeenLastCalledWith('-3.5')
  })

  it.each([
    [VarType.number, 'spinbutton'],
    [VarType.string, 'textbox'],
  ] as const)('names an unnamed %s constant until its variable is named', (varType, role) => {
    const item: LoopVariable = {
      id: 'new-variable',
      label: '',
      var_type: varType,
      value_type: ValueType.constant,
      value: '',
    }
    const { rerender } = render(<FormItem nodeId="loop-node" item={item} onChange={vi.fn()} />)
    expect(
      screen.getByRole(role, { name: 'workflow.errorMsg.fields.variableValue' }),
    ).toBeInTheDocument()

    rerender(
      <FormItem nodeId="loop-node" item={{ ...item, label: 'counter' }} onChange={vi.fn()} />,
    )
    expect(screen.getByRole(role, { name: 'counter' })).toBeInTheDocument()
  })
})
