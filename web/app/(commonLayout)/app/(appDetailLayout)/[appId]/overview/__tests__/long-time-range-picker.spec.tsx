import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TIME_PERIOD_MAPPING } from '@/app/components/app/log/filter'
import LongTimeRangePicker from '../long-time-range-picker'

describe('LongTimeRangePicker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts the selected period on the current date after the page stays open past midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true })
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <LongTimeRangePicker
        periodMapping={TIME_PERIOD_MAPPING}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD HH:mm"
      />,
    )

    vi.setSystemTime(new Date(2026, 11, 1, 9))
    await user.click(screen.getByRole('combobox'))
    await user.click(await screen.findByText('appLog.filter.period.monthToDate'))

    expect(onSelect).toHaveBeenLastCalledWith({
      name: 'appLog.filter.period.monthToDate',
      query: { start: '2026-12-01 00:00', end: '2026-12-01 23:59' },
    })
  })
})
