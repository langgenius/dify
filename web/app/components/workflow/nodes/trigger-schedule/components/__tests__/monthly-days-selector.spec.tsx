import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MonthlyDaysSelector from '../monthly-days-selector'

describe('trigger-schedule/monthly-days-selector', () => {
  it('toggles monthly days and shows the day-31 warning', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<MonthlyDaysSelector selectedDays={[31]} onChange={onChange} />)

    expect(screen.getByText('workflow.nodes.triggerSchedule.lastDayTooltip')).toBeInTheDocument()

    await user.click(screen.getByText('workflow.nodes.triggerSchedule.lastDay'))

    expect(onChange).toHaveBeenCalled()
  })

  it('keeps the clicked day selected when removing the last selected day', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<MonthlyDaysSelector selectedDays={[31]} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '31' }))

    expect(onChange).toHaveBeenCalledWith([31])
  })
})
