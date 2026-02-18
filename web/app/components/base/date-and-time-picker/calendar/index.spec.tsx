import type { CalendarProps, Day } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from '../utils/dayjs'
import Calendar from './index'

// Mock scrollIntoView since jsdom doesn't implement it
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Factory for creating mock days
const createMockDays = (count: number = 7): Day[] => {
  return Array.from({ length: count }, (_, i) => ({
    date: dayjs('2024-06-01').add(i, 'day'),
    isCurrentMonth: true,
  }))
}

// Factory for Calendar props
const createCalendarProps = (overrides: Partial<CalendarProps> = {}): CalendarProps => ({
  days: createMockDays(),
  selectedDate: undefined,
  onDateClick: vi.fn(),
  ...overrides,
})

describe('Calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render days of week header', () => {
      const props = createCalendarProps()
      render(<Calendar {...props} />)

      // DaysOfWeek component renders day labels
      const dayLabels = screen.getAllByText(/daysInWeek/)
      expect(dayLabels).toHaveLength(7)
    })

    it('should render all calendar day items', () => {
      const days = createMockDays(7)
      const props = createCalendarProps({ days })
      render(<Calendar {...props} />)

      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(7)
    })

    it('should accept wrapperClassName prop without errors', () => {
      const props = createCalendarProps({ wrapperClassName: 'custom-class' })
      const { container } = render(<Calendar {...props} />)

      // Verify the component renders successfully with wrapperClassName
      const dayLabels = screen.getAllByText(/daysInWeek/)
      expect(dayLabels).toHaveLength(7)
      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  // Interaction tests
  describe('Interactions', () => {
    it('should call onDateClick when a day is clicked', () => {
      const onDateClick = vi.fn()
      const days = createMockDays(3)
      const props = createCalendarProps({ days, onDateClick })
      render(<Calendar {...props} />)

      const dayButtons = screen.getAllByRole('button')
      fireEvent.click(dayButtons[1])

      expect(onDateClick).toHaveBeenCalledTimes(1)
      expect(onDateClick).toHaveBeenCalledWith(days[1].date)
    })
  })

  // Disabled dates tests
  describe('Disabled Dates', () => {
    it('should not call onDateClick for disabled dates', () => {
      const onDateClick = vi.fn()
      const days = createMockDays(3)
      // Disable all dates
      const getIsDateDisabled = vi.fn().mockReturnValue(true)
      const props = createCalendarProps({ days, onDateClick, getIsDateDisabled })
      render(<Calendar {...props} />)

      const dayButtons = screen.getAllByRole('button')
      fireEvent.click(dayButtons[0])

      expect(onDateClick).not.toHaveBeenCalled()
    })

    it('should pass getIsDateDisabled to CalendarItem', () => {
      const getIsDateDisabled = vi.fn().mockReturnValue(false)
      const days = createMockDays(2)
      const props = createCalendarProps({ days, getIsDateDisabled })
      render(<Calendar {...props} />)

      expect(getIsDateDisabled).toHaveBeenCalled()
    })
  })

  // Edge cases
  describe('Edge Cases', () => {
    it('should render empty calendar when days array is empty', () => {
      const props = createCalendarProps({ days: [] })
      render(<Calendar {...props} />)

      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })
  })
})
