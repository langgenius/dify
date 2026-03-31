import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from 'dayjs'
import RangeSelector from '../range-selector'

const ranges = [
  { value: 0, name: 'today' as const },
  { value: 7, name: 'last7days' as const },
]

describe('OverviewRouteRangeSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render the custom range label when custom mode is active', () => {
      render(
        <RangeSelector
          isCustomRange={true}
          ranges={ranges}
          onSelect={vi.fn()}
        />,
      )

      expect(screen.getByText('appLog.filter.period.custom')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should select the today option and emit a single-day range', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <RangeSelector
          isCustomRange={false}
          ranges={ranges}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(within(screen.getByRole('listbox')).getByText('appLog.filter.period.today'))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect.mock.calls[0][0].name).toBe('appLog.filter.period.today')
      expect(onSelect.mock.calls[0][0].query.start.isSame(dayjs().startOf('day'))).toBe(true)
      expect(onSelect.mock.calls[0][0].query.end.isSame(dayjs().endOf('day'))).toBe(true)
    })

    it('should select a relative range and emit the computed query window', async () => {
      const user = userEvent.setup()
      const onSelect = vi.fn()

      render(
        <RangeSelector
          isCustomRange={false}
          ranges={ranges}
          onSelect={onSelect}
        />,
      )

      await user.click(screen.getByRole('button'))
      await user.click(within(screen.getByRole('listbox')).getByText('appLog.filter.period.last7days'))

      expect(onSelect).toHaveBeenCalledTimes(1)
      expect(onSelect.mock.calls[0][0].name).toBe('appLog.filter.period.last7days')
      expect(onSelect.mock.calls[0][0].query.start.isSame(dayjs().subtract(7, 'day').startOf('day'))).toBe(true)
      expect(onSelect.mock.calls[0][0].query.end.isSame(dayjs().endOf('day'))).toBe(true)
    })
  })
})
