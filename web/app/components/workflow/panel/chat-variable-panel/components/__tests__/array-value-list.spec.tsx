import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ArrayValueList from '../array-value-list'

describe('ArrayValueList', () => {
  it('updates string items, appends a row, and removes an item', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <ArrayValueList isString list={['alpha', 'beta']} onChange={onChange} />,
    )

    await user.type(
      screen.getByRole('textbox', { name: 'workflow.chatVariable.modal.arrayValue 1' }),
      'x',
    )
    await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))
    await user.click(container.querySelector('button') as HTMLButtonElement)

    expect(onChange).toHaveBeenNthCalledWith(1, ['alphax', 'beta'])
    expect(onChange).toHaveBeenNthCalledWith(2, ['alpha', 'beta', undefined])
    expect(onChange).toHaveBeenNthCalledWith(3, ['beta'])
  })

  it('edits decimal numbers and keeps cleared rows empty instead of converting them to zero', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function NumericArray() {
      const [list, setList] = useState<Array<string | number | undefined>>([1])
      return (
        <ArrayValueList
          isString={false}
          list={list}
          onChange={(value) => {
            setList(value)
            onChange(value)
          }}
        />
      )
    }
    render(<NumericArray />)

    const input = screen.getByRole('textbox', { name: 'workflow.chatVariable.modal.arrayValue 1' })
    await user.clear(input)
    await user.type(input, '-7.123456')
    await user.tab()
    expect(onChange).toHaveBeenLastCalledWith([-7.123456])
    expect(input).toHaveValue('-7.123456')
    await user.clear(input)
    await user.tab()
    expect(input).toHaveValue('')
    expect(onChange).toHaveBeenLastCalledWith([undefined])
    await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))

    expect(onChange).toHaveBeenLastCalledWith([undefined, undefined])
  })
})
