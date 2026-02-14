import type { CalendarItemProps, Day } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from '../utils/dayjs'
import Item from './item'

// Factory function for creating mock Day objects
const createMockDay = (overrides: Partial<Day> = {}): Day => ({
  date: dayjs('2024-06-15'),
  isCurrentMonth: true,
  ...overrides,
})

// Factory function for creating CalendarItem props
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
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render the day number', () => {
      const props = createItemProps()
      render(<Item {...props} />)

      expect(screen.getByRole('button', { name: '15' })).toBeInTheDocument()
    })

    it('should render as a button element', () => {
      const props = createItemProps()
      render(<Item {...props} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  // Visual state tests
  describe('Visual States', () => {
    it('should apply selected styling when date matches selectedDate', () => {
      const selectedDate = dayjs('2024-06-15')
      const props = createItemProps({ selectedDate })
      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('bg-components-button-primary-bg')
    })

    it('should not apply selected styling when date does not match selectedDate', () => {
      const selectedDate = dayjs('2024-06-16')
      const props = createItemProps({ selectedDate })
      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button.className).not.toContain('bg-components-button-primary-bg')
    })

    it('should apply quaternary text when day is not in current month', () => {
      const props = createItemProps({
        day: createMockDay({ isCurrentMonth: false }),
      })
      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('text-text-quaternary')
    })

    it('should apply secondary text when day is in current month', () => {
      const props = createItemProps({
        day: createMockDay({ isCurrentMonth: true }),
      })
      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('text-text-secondary')
    })

    it('should apply disabled styling when isDisabled is true', () => {
      const props = createItemProps({ isDisabled: true })
      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button.className).toContain('cursor-not-allowed')
    })
  })

  // Click behavior tests
  describe('Click Behavior', () => {
    it('should call onClick with the date when clicked', () => {
      const onClick = vi.fn()
      const day = createMockDay()
      const props = createItemProps({ day, onClick })
      render(<Item {...props} />)

      fireEvent.click(screen.getByRole('button'))

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(onClick).toHaveBeenCalledWith(day.date)
    })

    it('should not call onClick when isDisabled is true', () => {
      const onClick = vi.fn()
      const props = createItemProps({ onClick, isDisabled: true })
      render(<Item {...props} />)

      fireEvent.click(screen.getByRole('button'))

      expect(onClick).not.toHaveBeenCalled()
    })
  })

  // Today indicator test
  describe('Today Indicator', () => {
    it('should render today indicator dot when date is today', () => {
      const today = dayjs()
      const props = createItemProps({
        day: createMockDay({ date: today }),
      })
      const { container } = render(<Item {...props} />)

      // The today dot is an absolutely positioned div inside the button
      const dot = container.querySelector('.rounded-full')
      expect(dot).toBeInTheDocument()
    })

    it('should not render today indicator when date is not today', () => {
      const notToday = dayjs('2020-01-01')
      const props = createItemProps({
        day: createMockDay({ date: notToday }),
      })
      const { container } = render(<Item {...props} />)

      const dot = container.querySelector('.rounded-full')
      expect(dot).not.toBeInTheDocument()
    })
  })
})
