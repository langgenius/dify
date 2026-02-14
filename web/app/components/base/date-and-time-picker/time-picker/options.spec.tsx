import type { TimeOptionsProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from '../utils/dayjs'
import Options from './options'

// Mock scrollIntoView since jsdom doesn't implement it
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Factory for Options props
const createOptionsProps = (overrides: Partial<TimeOptionsProps> = {}): TimeOptionsProps => ({
  selectedTime: undefined,
  handleSelectHour: vi.fn(),
  handleSelectMinute: vi.fn(),
  handleSelectPeriod: vi.fn(),
  ...overrides,
})

describe('TimePickerOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render 12 hour options', () => {
      const props = createOptionsProps()
      render(<Options {...props} />)

      // Hours 01-12 overlap with minutes 01-12, so verify via list count.
      // The first <ul> contains hours. Each list has OptionListItem children.
      const allLists = document.querySelectorAll('ul')
      expect(allLists).toHaveLength(3)

      // First list is hours - should have 12 items
      const hourItems = allLists[0].querySelectorAll('li')
      expect(hourItems).toHaveLength(12)
    })

    it('should render 60 minute options by default', () => {
      const props = createOptionsProps()
      render(<Options {...props} />)

      // Check for minute 00 and 59
      const allItems = screen.getAllByRole('listitem')
      // 12 hours + 60 minutes + 2 periods = 74 items
      expect(allItems).toHaveLength(74)
    })

    it('should render AM and PM period options', () => {
      const props = createOptionsProps()
      render(<Options {...props} />)

      expect(screen.getByText('AM')).toBeInTheDocument()
      expect(screen.getByText('PM')).toBeInTheDocument()
    })
  })

  // Selection state tests
  describe('Selection', () => {
    it('should highlight the selected hour', () => {
      const selectedTime = dayjs('2024-01-01 14:30:00') // 2:30 PM -> hour 02 in 12h
      const props = createOptionsProps({ selectedTime })
      render(<Options {...props} />)

      // Hour "02" appears in both hours and minutes lists.
      // The first <ul> is hours - check its "02" item
      const hourList = document.querySelectorAll('ul')[0]
      const hourItems = hourList.querySelectorAll('li')
      // "02" is at index 1 (hours are 01,02,...,12)
      expect(hourItems[1].className).toContain('bg-components-button-ghost-bg-hover')
    })

    it('should highlight the selected minute', () => {
      const selectedTime = dayjs('2024-01-01 14:30:00')
      const props = createOptionsProps({ selectedTime })
      render(<Options {...props} />)

      // Minute "30" should be selected
      const minuteItem = screen.getByText('30').closest('li')
      expect(minuteItem?.className).toContain('bg-components-button-ghost-bg-hover')
    })
  })

  // Minute filter tests
  describe('Minute Filter', () => {
    it('should apply minuteFilter when provided', () => {
      const minuteFilter = (minutes: string[]) => minutes.filter(m => Number(m) % 15 === 0)
      const props = createOptionsProps({ minuteFilter })
      render(<Options {...props} />)

      // Only 00, 15, 30, 45 should be present as minute options
      // Total items: 12 hours + 4 filtered minutes + 2 periods = 18
      const allItems = screen.getAllByRole('listitem')
      expect(allItems).toHaveLength(18)
    })
  })

  // Click handler tests
  describe('Interactions', () => {
    it('should call handleSelectHour when an hour is clicked', () => {
      const handleSelectHour = vi.fn()
      const props = createOptionsProps({ handleSelectHour })
      render(<Options {...props} />)

      // Hours 01-12 appear in the first list; "11" is unique to hours only
      // (minutes also have "11" so use getAllByText and pick the first one - which is the hour)
      const allElevens = screen.getAllByText('11')
      fireEvent.click(allElevens[0]) // First occurrence is in the hour list

      expect(handleSelectHour).toHaveBeenCalledWith('11')
    })

    it('should call handleSelectMinute when a minute is clicked', () => {
      const handleSelectMinute = vi.fn()
      const props = createOptionsProps({ handleSelectMinute })
      render(<Options {...props} />)

      // "30" is only in minutes (hours go 01-12), so it's unique
      fireEvent.click(screen.getByText('30'))

      expect(handleSelectMinute).toHaveBeenCalledWith('30')
    })

    it('should call handleSelectPeriod when AM is clicked', () => {
      const handleSelectPeriod = vi.fn()
      const props = createOptionsProps({ handleSelectPeriod })
      render(<Options {...props} />)

      fireEvent.click(screen.getByText('AM'))

      expect(handleSelectPeriod).toHaveBeenCalledWith('AM')
    })

    it('should call handleSelectPeriod when PM is clicked', () => {
      const handleSelectPeriod = vi.fn()
      const props = createOptionsProps({ handleSelectPeriod })
      render(<Options {...props} />)

      fireEvent.click(screen.getByText('PM'))

      expect(handleSelectPeriod).toHaveBeenCalledWith('PM')
    })
  })
})
