import type { LoopVariable } from '@/app/components/workflow/nodes/loop/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ValueType, VarType } from '@/app/components/workflow/types'
import Item from '../item'

describe('Loop variable item', () => {
  it('normalizes an edited name and removes the same variable by its stable ID', async () => {
    const user = userEvent.setup()
    const update = vi.fn()
    const remove = vi.fn()
    function LoopDraft() {
      const [item, setItem] = useState<LoopVariable>({
        id: 'loop-variable',
        label: 'item',
        var_type: VarType.string,
        value_type: ValueType.constant,
        value: '',
      })
      return (
        <Item
          nodeId="loop-node"
          item={item}
          handleRemoveLoopVariable={remove}
          handleUpdateLoopVariable={(id, changes) => {
            setItem((current) => ({ ...current, ...changes }))
            update(id, changes)
          }}
        />
      )
    }
    render(<LoopDraft />)

    const name = screen.getByRole('textbox', { name: 'workflowLogic.nodes.loop.variableName' })
    await user.clear(name)
    await user.type(name, 'new name')
    expect(name).toHaveValue('new_name')
    expect(update).toHaveBeenLastCalledWith('loop-variable', { label: 'new_name' })

    await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
    expect(remove).toHaveBeenCalledExactlyOnceWith('loop-variable')
  })
})
