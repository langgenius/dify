import type { CalendarItemProps, Day } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from '../utils/dayjs'
import Item from './item'

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
  })

  describe('Rendering', () => {
    it('should render the day number', () => {
      const props = createItemProps()

      render(<Item {...props} />)

      expect(screen.getByRole('button', { name: '15' })).toBeInTheDocument()
    })
  })

  describe('Visual States', () => {
    it('should have selected styles when date matches selectedDate', () => {
      const selectedDate = dayjs('2024-06-15')
      const props = createItemProps({ selectedDate })

      render(<Item {...props} />)
      const button = screen.getByRole('button', { name: '15' })
      expect(button).toHaveClass('bg-components-button-primary-bg', 'text-components-button-primary-text')
    })

    it('should not have selected styles when date does not match selectedDate', () => {
      const selectedDate = dayjs('2024-06-16')
      const props = createItemProps({ selectedDate })

      render(<Item {...props} />)
      const button = screen.getByRole('button', { name: '15' })
      expect(button).not.toHaveClass('bg-components-button-primary-bg', 'text-components-button-primary-text')
    })

    it('should have different styles when day is not in current month', () => {
      const props = createItemProps({
        day: createMockDay({ isCurrentMonth: false }),
      })

      render(<Item {...props} />)
      const button = screen.getByRole('button', { name: '15' })
      expect(button).toHaveClass('text-text-quaternary')
    })

    it('should have different styles when day is in current month', () => {
      const props = createItemProps({
        day: createMockDay({ isCurrentMonth: true }),
      })

      render(<Item {...props} />)
      const button = screen.getByRole('button', { name: '15' })
      expect(button).toHaveClass('text-text-secondary')
    })
  })

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

  describe('Today Indicator', () => {
    it('should render today indicator when date is today', () => {
      const today = dayjs()
      const props = createItemProps({
        day: createMockDay({ date: today }),
      })

      render(<Item {...props} />)

      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      // Today's button should contain a child indicator element
      expect(button.children.length).toBeGreaterThan(0)
    })

    it('should not render today indicator when date is not today', () => {
      const notToday = dayjs('2020-01-01')
      const props = createItemProps({
        day: createMockDay({ date: notToday }),
      })

      render(<Item {...props} />)

      const button = screen.getByRole('button')
      // Non-today button should only contain the day number text, no extra children
      expect(button.children.length).toBe(0)
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
