import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DataType } from '../../types'
import InputCombined from '../input-combined'

it('commits numeric input as a number and converts a cleared value to zero', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState(12)
    return (
      <InputCombined
        label="Quantity"
        type={DataType.number}
        value={value}
        onChange={(next: number) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Harness />)
  const input = screen.getByRole('textbox', { name: 'Quantity' })
  await user.type(input, '3')
  expect(onChange).toHaveBeenLastCalledWith(123)
  await user.clear(input)
  expect(onChange).toHaveBeenLastCalledWith(0)
})

it.each([DataType.string, DataType.number])(
  'prevents changes to a read-only %s field',
  async (type) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <InputCombined
        label="Metadata"
        type={type}
        value={type === DataType.string ? 'Value' : 42}
        onChange={onChange}
        readOnly
      />,
    )
    const input = screen.getByRole('textbox', { name: 'Metadata' })
    expect(input).toHaveAttribute('readonly')
    await user.type(input, '7')
    expect(onChange).not.toHaveBeenCalled()
  },
)
