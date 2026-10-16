import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WeekdaySelector from '../weekday-selector'

describe('trigger-schedule/weekday-selector', () => {
  it('names the weekday selection group', () => {
    render(<WeekdaySelector selectedDays={['mon']} onChange={vi.fn()} />)

    expect(
      screen.getByRole('group', { name: 'workflow.nodes.triggerSchedule.weekdays' }),
    ).toBeInTheDocument()
  })

  it('exposes the selected weekdays as pressed', () => {
    render(<WeekdaySelector selectedDays={['mon', 'wed']} onChange={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Mon', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Wed', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tue', pressed: false })).toBeInTheDocument()
  })

  it('keeps at least one weekday selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<WeekdaySelector selectedDays={['mon']} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Mon' }))

    expect(onChange).toHaveBeenCalledWith(['mon'])
  })

  it('adds a new weekday when the day is not selected yet', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<WeekdaySelector selectedDays={[]} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'Tue' }))

    expect(onChange).toHaveBeenCalledWith(['tue'])
  })
})
