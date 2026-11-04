import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModeToggle from '../mode-toggle'

describe('trigger-schedule/mode-toggle', () => {
  it('toggles the mode from visual to cron', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ModeToggle mode="visual" onChange={onChange} />)

    await user.click(screen.getByRole('button'))

    expect(onChange).toHaveBeenCalledWith('cron')
  })

  it('toggles the mode from cron back to visual', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ModeToggle mode="cron" onChange={onChange} />)

    await user.click(screen.getByRole('button'))

    expect(onChange).toHaveBeenCalledWith('visual')
  })
})
