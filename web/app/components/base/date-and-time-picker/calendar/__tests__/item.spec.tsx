import type { CalendarItemProps, Day } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import dayjs from '../../utils/dayjs'
import Item from '../item'

const locale = vi.hoisted(() => ({ value: 'en-US' }))

vi.mock('@/context/i18n', () => ({
  useLocale: () => locale.value,
}))

const createMockDay = (overrides: Partial<Day> = {}): Day => ({
  date: dayjs('2024-06-15'),
  isCurrentMonth: true,
  ...overrides,
})

const createItemProps = (overrides: Partial<CalendarItemProps> = {}): CalendarItemProps => ({
  day: createMockDay(),
  selectedDate: undefined,
  onClick: vi.fn(),
  isDisabled: false,
  ...overrides,
})

describe('CalendarItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    locale.value = 'en-US'
  })

  describe('Rendering', () => {
    it('should render the day number', () => {
      const props = createItemProps()

      render(<Item {...props} />)

      expect(screen.getByRole('button', { name: 'Saturday, June 15, 2024' })).toHaveTextContent(
        '15',
      )
    })

    it('should localize the full date without changing the calendar date across time zones', () => {
      locale.value = 'zh-Hans'
      const props = createItemProps({
        day: createMockDay({ date: dayjs.tz('2024-06-15 00:00', 'Pacific/Kiritimati') }),
      })

      render(<Item {...props} />)

      expect(screen.getByRole('button', { name: '2024年6月15日星期六' })).toHaveTextContent('15')
    })

    it.each([
      ['fa-IR', 'شنبه ۱۵ ژوئن ۲۰۲۴'],
      ['th-TH', 'วันเสาร์ที่ 15 มิถุนายน ค.ศ. 2024'],
    ])('should keep the displayed Gregorian date in %s', (language, name) => {
      locale.value = language
      render(<Item {...createItemProps()} />)

      expect(screen.getByRole('button', { name })).toHaveTextContent('15')
    })

    it('should expose selection and update it when another date is selected', () => {
      const props = createItemProps({ selectedDate: dayjs('2024-06-15') })
      const { rerender } = render(<Item {...props} />)

      expect(screen.getByRole('button', { pressed: true })).toHaveAccessibleName(
        'Saturday, June 15, 2024',
      )

      rerender(<Item {...props} selectedDate={dayjs('2024-06-16')} />)

      expect(screen.getByRole('button', { pressed: false })).toHaveAccessibleName(
        'Saturday, June 15, 2024',
      )
    })
  })

  describe('Click Behavior', () => {
    it('should call onClick with the date when clicked', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const day = createMockDay()
      const props = createItemProps({ day, onClick })

      render(<Item {...props} />)
      await user.click(screen.getByRole('button'))

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onClick).toHaveBeenCalledWith(day.date)
    })

    it('should expose disabled dates and prevent activation', async () => {
      const user = userEvent.setup()
      const onClick = vi.fn()
      const props = createItemProps({ onClick, isDisabled: true })

      render(<Item {...props} />)
      expect(screen.getByRole('button')).toBeDisabled()
      await user.click(screen.getByRole('button'))

      expect(onClick).not.toHaveBeenCalled()
    })
  })

  describe('Today Indicator', () => {
    it('should render today indicator when date is today', () => {
      const today = dayjs()
      const props = createItemProps({
        day: createMockDay({ date: today }),
      })

      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-current', 'date')
    })

    it('should not render today indicator when date is not today', () => {
      const notToday = dayjs('2020-01-01')
      const props = createItemProps({
        day: createMockDay({ date: notToday }),
      })

      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button).not.toHaveAttribute('aria-current')
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined selectedDate', () => {
      const props = createItemProps({ selectedDate: undefined })

      render(<Item {...props} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
