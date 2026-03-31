import type { Item } from '@/app/components/base/select'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import LongTimeRangePicker from '../long-time-range-picker'

const simpleSelectState = vi.hoisted(() => ({
  items: [] as Item[],
  onSelect: null as null | ((item: Item) => void),
}))

vi.mock('@/app/components/base/select', () => ({
  SimpleSelect: ({
    items,
    onSelect,
  }: {
    items: Item[]
    onSelect: (item: Item) => void
  }) => {
    simpleSelectState.items = items
    simpleSelectState.onSelect = onSelect

    return (
      <div>
        <button
          type="button"
          onClick={() => onSelect({ value: 'missing-period', name: '' })}
        >
          trigger-fallback-period
        </button>
      </div>
    )
  },
}))

describe('OverviewRouteLongTimeRangePickerFallbackBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    simpleSelectState.items = []
    simpleSelectState.onSelect = null
  })

  it('should keep using the fallback callback payload when the select callback receives an unmapped item', () => {
    const onSelect = vi.fn()

    render(
      <LongTimeRangePicker
        periodMapping={{
          '-1': { value: -1, name: 'allTime' },
          '2': { value: 30, name: 'last30days' },
        }}
        onSelect={onSelect}
        queryDateFormat="YYYY-MM-DD"
      />,
    )

    expect(simpleSelectState.items).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'trigger-fallback-period' }))

    expect(onSelect).toHaveBeenCalledWith({
      name: 'appLog.filter.period.allTime',
      query: {
        start: dayjs().subtract(-1, 'day').startOf('day').format('YYYY-MM-DD'),
        end: dayjs().endOf('day').format('YYYY-MM-DD'),
      },
    })
  })
})
