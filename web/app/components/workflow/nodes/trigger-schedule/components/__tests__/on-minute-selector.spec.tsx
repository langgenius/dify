import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OnMinuteSelector from '../on-minute-selector'

describe('trigger-schedule/on-minute-selector', () => {
  it('changes the hourly minute through the slider', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    const { rerender } = render(<OnMinuteSelector value={15} onChange={onChange} />)

    const slider = screen.getByRole('slider', {
      name: 'workflowIntegrations.nodes.triggerSchedule.onMinute',
    })
    expect(screen.getByRole('status')).toHaveTextContent('15')
    expect(screen.getByRole('status')).toHaveAttribute('for', slider.id)
    slider.focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith(16, expect.objectContaining({ activeThumbIndex: 0 }))
    rerender(<OnMinuteSelector value={16} onChange={onChange} />)
    expect(screen.getByRole('status')).toHaveTextContent('16')
  })
})
