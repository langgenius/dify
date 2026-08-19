import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WeekdaySelector from '../weekday-selector'

describe('trigger-schedule/weekday-selector', () => {
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
