import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Input from '../Input'

it('clamps values to the configured range on blur', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(<Input placeholder="Limit" onChange={onChange} min={2} max={6} />)
  const input = screen.getByRole('textbox')
  await user.type(input, '1')
  await user.tab()
  expect(onChange).toHaveBeenLastCalledWith('2')

  await user.clear(input)
  await user.type(input, '8')
  await user.tab()
  expect(onChange).toHaveBeenLastCalledWith('6')
})
