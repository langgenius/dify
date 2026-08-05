import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DisplayToggle from '../display-toggle'

describe('DisplayToggle', () => {
  it('toggles the document display', async () => {
    const user = userEvent.setup()
    const toggleCollapsed = vi.fn()
    render(<DisplayToggle isCollapsed toggleCollapsed={toggleCollapsed} />)

    await user.click(screen.getByRole('button'))

    expect(toggleCollapsed).toHaveBeenCalledTimes(1)
  })
})
