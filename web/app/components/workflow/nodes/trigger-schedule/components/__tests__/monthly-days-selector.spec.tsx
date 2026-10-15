import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MonthlyDaysSelector from '../monthly-days-selector'

describe('trigger-schedule/monthly-days-selector', () => {
  it('names the monthly day selection group', () => {
    render(<MonthlyDaysSelector selectedDays={[1]} onChange={vi.fn()} />)

    expect(
      screen.getByRole('group', { name: 'workflowIntegrations.nodes.triggerSchedule.days' }),
    ).toBeInTheDocument()
  })

  it('exposes the selected days as pressed', () => {
    render(<MonthlyDaysSelector selectedDays={[1, 'last']} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: '1', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2', pressed: false })).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: 'workflowIntegrations.nodes.triggerSchedule.lastDay',
        pressed: true,
      }),
    ).toBeInTheDocument()
  })

  it('toggles monthly days and shows the day-31 warning', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<MonthlyDaysSelector selectedDays={[31]} onChange={onChange} />)

    expect(
      screen.getByText('workflowIntegrations.nodes.triggerSchedule.lastDayTooltip'),
    ).toBeInTheDocument()

    await user.click(screen.getByText('workflowIntegrations.nodes.triggerSchedule.lastDay'))

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
