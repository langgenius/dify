import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FrequencySelector from '../frequency-selector'

describe('trigger-schedule/frequency-selector', () => {
  it('selects a new frequency from the dropdown options', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <FrequencySelector
        frequency="daily"
        onChange={onChange}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'workflow.nodes.triggerSchedule.frequency.daily' })
    await user.click(trigger)

    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    await user.click(await screen.findByText('workflow.nodes.triggerSchedule.frequency.weekly'))

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('weekly')
    })
  })
})
