import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BoolValue from '../bool-value'

describe('BoolValue', () => {
  it('switches between true and false values', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(<BoolValue value onChange={onChange} />)

    await user.click(screen.getByText('False'))
    rerender(<BoolValue value={false} onChange={onChange} />)
    await user.click(screen.getByText('True'))

    expect(onChange).toHaveBeenNthCalledWith(1, false)
    expect(onChange).toHaveBeenNthCalledWith(2, true)
  })
})
