import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import { MonitoringDateRangePicker } from '../date-range-picker'

it('limits monitoring ranges to 30 days and updates only the selected endpoint', async () => {
  vi.setSystemTime(new Date('2025-02-28T12:00:00Z'))
  try {
    const user = userEvent.setup()
    const startChanged = vi.fn()
    const endChanged = vi.fn()
    render(
      <MonitoringDateRangePicker
        start={dayjs('2025-01-01')}
        end={dayjs('2025-01-20')}
        onStartChange={startChanged}
        onEndChange={endChanged}
      />,
    )
    await user.click(screen.getByRole('button', { name: /picker.endDate/ }))
    expect(screen.getByRole('button', { name: /picker.nextMonth/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /January 31st, 2025/ }))
    expect(endChanged).toHaveBeenCalledOnce()
    expect(endChanged.mock.calls[0]![0].format('YYYY-MM-DD')).toBe('2025-01-31')
    expect(startChanged).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('disallows future dates even when they fit within the 30-day range', async () => {
  vi.setSystemTime(new Date('2025-01-25T12:00:00Z'))
  try {
    const user = userEvent.setup()
    render(
      <MonitoringDateRangePicker
        start={dayjs('2025-01-10')}
        end={dayjs('2025-01-20')}
        onStartChange={vi.fn()}
        onEndChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /picker.endDate/ }))
    expect(screen.getByRole('button', { name: /January 25th, 2025/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /January 26th, 2025/ })).toBeDisabled()
  } finally {
    vi.useRealTimers()
  }
})
