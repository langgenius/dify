import type { YearAndMonthPickerOptionsProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import Options from './options'

// Mock scrollIntoView since jsdom doesn't implement it
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Factory for Options props
const createOptionsProps = (overrides: Partial<YearAndMonthPickerOptionsProps> = {}): YearAndMonthPickerOptionsProps => ({
  selectedMonth: 5, // June (0-indexed)
  selectedYear: 2024,
  handleMonthSelect: vi.fn(),
  handleYearSelect: vi.fn(),
  ...overrides,
})

describe('YearAndMonthPicker Options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render 12 month options', () => {
      const props = createOptionsProps()
      render(<Options {...props} />)

      // useMonths returns translated month keys
      const monthItems = screen.getAllByText(/months\./)
      expect(monthItems).toHaveLength(12)
    })

    it('should render 200 year options', () => {
      const props = createOptionsProps()
      render(<Options {...props} />)

      // useYearOptions returns 200 years
      const allItems = screen.getAllByRole('listitem')
      // 12 months + 200 years = 212
      expect(allItems).toHaveLength(212)
    })
  })

  // Interaction tests
  describe('Interactions', () => {
    it('should call handleMonthSelect when a month is clicked', () => {
      const handleMonthSelect = vi.fn()
      const props = createOptionsProps({ handleMonthSelect })
      render(<Options {...props} />)

      // Click the first month (January at index 0)
      const monthItems = screen.getAllByText(/months\./)
      fireEvent.click(monthItems[0])

      expect(handleMonthSelect).toHaveBeenCalledWith(0)
    })

    it('should call handleYearSelect when a year is clicked', () => {
      const handleYearSelect = vi.fn()
      const props = createOptionsProps({ handleYearSelect })
      render(<Options {...props} />)

      // Click on the selected year (2024)
      fireEvent.click(screen.getByText('2024'))

      expect(handleYearSelect).toHaveBeenCalledWith(2024)
    })
  })

  // Selection highlighting tests
  describe('Selection', () => {
    it('should highlight the selected month', () => {
      const props = createOptionsProps({ selectedMonth: 0 }) // January
      render(<Options {...props} />)

      const monthItems = screen.getAllByText(/months\./)
      const januaryItem = monthItems[0].closest('li')
      expect(januaryItem?.className).toContain('bg-components-button-ghost-bg-hover')
    })

    it('should highlight the selected year', () => {
      const props = createOptionsProps({ selectedYear: 2024 })
      render(<Options {...props} />)

      const yearItem = screen.getByText('2024').closest('li')
      expect(yearItem?.className).toContain('bg-components-button-ghost-bg-hover')
    })
  })
})
