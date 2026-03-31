import type { Dayjs } from 'dayjs'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import TimeRangePicker from '../index'

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/utils/format', async () => {
  const actual = await vi.importActual<typeof import('@/utils/format')>('@/utils/format')
  return {
    ...actual,
    formatToLocalTime: (value: Dayjs, _locale: string, format: string) => value.format(format),
  }
})

vi.mock('../date-picker', () => ({
  default: ({
    start,
    end,
    onStartChange,
    onEndChange,
  }: {
    start: Dayjs
    end: Dayjs
    onStartChange: (date?: Dayjs) => void
    onEndChange: (date?: Dayjs) => void
  }) => (
    <div>
      <div data-testid="date-picker-range">{`${start.format('MMM D')} - ${end.format('MMM D')}`}</div>
      <button type="button" onClick={() => onStartChange(undefined)}>skip-start</button>
      <button type="button" onClick={() => onStartChange(start)}>same-start</button>
      <button type="button" onClick={() => onStartChange(start.subtract(1, 'day'))}>change-start</button>
      <button type="button" onClick={() => onEndChange(end)}>same-end</button>
      <button type="button" onClick={() => onEndChange(end.add(1, 'day'))}>change-end</button>
    </div>
  ),
}))

vi.mock('../range-selector', () => ({
  default: ({
    isCustomRange,
    onSelect,
  }: {
    isCustomRange: boolean
    onSelect: (payload: { name: string, query: { start: Dayjs, end: Dayjs } }) => void
  }) => (
    <div>
      <div data-testid="range-mode">{isCustomRange ? 'custom' : 'preset'}</div>
      <button
        type="button"
        onClick={() => onSelect({
          name: 'appLog.filter.period.last7days',
          query: {
            start: dayjs('2026-03-01'),
            end: dayjs('2026-03-08'),
          },
        })}
      >
        select-range
      </button>
    </div>
  ),
}))

describe('OverviewRouteTimeRangePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should format a preset range selection and keep preset mode', () => {
    const onSelect = vi.fn()

    render(
      <TimeRangePicker
        ranges={[{ value: 7, name: 'last7days' }]}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'select-range' }))

    expect(onSelect).toHaveBeenCalledWith({
      name: 'appLog.filter.period.last7days',
      query: {
        start: '2026-03-01',
        end: '2026-03-08',
      },
    })
    expect(screen.getByTestId('range-mode')).toHaveTextContent('preset')
  })

  it('should ignore empty or unchanged date updates', () => {
    const onSelect = vi.fn()

    render(
      <TimeRangePicker
        ranges={[{ value: 7, name: 'last7days' }]}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'skip-start' }))
    fireEvent.click(screen.getByRole('button', { name: 'same-start' }))
    fireEvent.click(screen.getByRole('button', { name: 'same-end' }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByTestId('range-mode')).toHaveTextContent('preset')
  })

  it('should format custom date changes and switch to custom mode', () => {
    const onSelect = vi.fn()

    render(
      <TimeRangePicker
        ranges={[{ value: 7, name: 'last7days' }]}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'change-start' }))
    fireEvent.click(screen.getByRole('button', { name: 'change-end' }))

    expect(onSelect).toHaveBeenNthCalledWith(1, {
      name: `${dayjs().subtract(1, 'day').format('MMM D')} - ${dayjs().format('MMM D')}`,
      query: {
        start: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
        end: dayjs().format('YYYY-MM-DD'),
      },
    })
    expect(onSelect).toHaveBeenNthCalledWith(2, {
      name: `${dayjs().subtract(1, 'day').format('MMM D')} - ${dayjs().add(1, 'day').format('MMM D')}`,
      query: {
        start: dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
        end: dayjs().add(1, 'day').format('YYYY-MM-DD'),
      },
    })
    expect(screen.getByTestId('range-mode')).toHaveTextContent('custom')
  })
})
