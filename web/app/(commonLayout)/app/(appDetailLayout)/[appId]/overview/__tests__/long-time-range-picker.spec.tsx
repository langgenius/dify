import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import LongTimeRangePicker from '../long-time-range-picker'

const periodMapping = {
  '-1': { value: -1, name: 'allTime' as const },
  '0': { value: 0, name: 'today' as const },
  '2': { value: 30, name: 'last30days' as const },
}

describe('OverviewRouteLongTimeRangePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the translated default option', () => {
    render(
      <LongTimeRangePicker
        periodMapping={periodMapping}
        onSelect={vi.fn()}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    expect(screen.getByText('appLog.filter.period.last30days')).toBeInTheDocument()
  })

  it('should emit an all-time selection without query params', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <LongTimeRangePicker
        periodMapping={periodMapping}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    await user.click(screen.getByRole('button'))
    await user.click(within(screen.getByRole('listbox')).getByText('appLog.filter.period.allTime'))

    expect(onSelect).toHaveBeenCalledWith({
      name: 'appLog.filter.period.allTime',
      query: undefined,
    })
  })

  it('should emit a today selection with start and end of day', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <LongTimeRangePicker
        periodMapping={periodMapping}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    await user.click(screen.getByRole('button'))
    await user.click(within(screen.getByRole('listbox')).getByText('appLog.filter.period.today'))

    expect(onSelect).toHaveBeenCalledWith({
      name: 'appLog.filter.period.today',
      query: {
        start: dayjs().startOf('day').format('YYYY-MM-DD'),
        end: dayjs().endOf('day').format('YYYY-MM-DD'),
      },
    })
  })

  it('should emit a relative time window for normal period selections', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <LongTimeRangePicker
        periodMapping={periodMapping}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    await user.click(screen.getByRole('button'))
    await user.click(within(screen.getByRole('listbox')).getByText('appLog.filter.period.last30days'))

    expect(onSelect).toHaveBeenCalledWith({
      name: 'appLog.filter.period.last30days',
      query: {
        start: dayjs().subtract(30, 'day').startOf('day').format('YYYY-MM-DD'),
        end: dayjs().endOf('day').format('YYYY-MM-DD'),
      },
    })
  })
})
