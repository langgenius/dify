import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModeSwitcher from '../mode-switcher'

describe('trigger-schedule/mode-switcher', () => {
  it('switches between visual and cron modes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<ModeSwitcher mode="visual" onChange={onChange} />)

    await user.click(screen.getByText('workflow.nodes.triggerSchedule.modeCron'))

    expect(onChange).toHaveBeenCalledWith('cron')
  })
})
