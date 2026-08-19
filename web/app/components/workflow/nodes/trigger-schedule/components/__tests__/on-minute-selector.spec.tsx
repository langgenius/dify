import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OnMinuteSelector from '../on-minute-selector'

describe('trigger-schedule/on-minute-selector', () => {
  it('changes the hourly minute through the slider', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<OnMinuteSelector value={15} onChange={onChange} />)

    const slider = screen.getByLabelText('workflow.nodes.triggerSchedule.onMinute')
    slider.focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith(16, expect.objectContaining({ activeThumbIndex: 0 }))
  })
})
