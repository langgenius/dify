import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ArrayValueList from '../array-value-list'

describe('ArrayValueList', () => {
  it('updates string items, appends a row, and removes an item', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(
      <ArrayValueList
        isString
        list={['alpha', 'beta']}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('alpha'), { target: { value: 'updated' } })
    await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))
    await user.click(container.querySelector('button') as HTMLButtonElement)

    expect(onChange).toHaveBeenNthCalledWith(1, ['updated', 'beta'])
    expect(onChange).toHaveBeenNthCalledWith(2, ['alpha', 'beta', undefined])
    expect(onChange).toHaveBeenNthCalledWith(3, ['beta'])
  })

  it('coerces number inputs and appends an undefined slot', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ArrayValueList
        isString={false}
        list={[1]}
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '7' } })
    await user.click(screen.getByText('workflow.chatVariable.modal.addArrayValue'))

    expect(onChange).toHaveBeenNthCalledWith(1, [7])
    expect(onChange).toHaveBeenNthCalledWith(2, [1, undefined])
  })
})
