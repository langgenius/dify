import type { YearAndMonthPickerOptionsProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import Options from './options'

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const createOptionsProps = (overrides: Partial<YearAndMonthPickerOptionsProps> = {}): YearAndMonthPickerOptionsProps => ({
  selectedMonth: 5,
  selectedYear: 2024,
  handleMonthSelect: vi.fn(),
  handleYearSelect: vi.fn(),
  ...overrides,
})

describe('YearAndMonthPicker Options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render month options', () => {
      const props = createOptionsProps()

      render(<Options {...props} />)

      const monthItems = screen.getAllByText(/months\./)
      expect(monthItems).toHaveLength(12)
    })

    it('should render year options', () => {
      const props = createOptionsProps()

      render(<Options {...props} />)

      const allItems = screen.getAllByRole('listitem')
      expect(allItems).toHaveLength(212)
    })
  })

  describe('Interactions', () => {
    it('should call handleMonthSelect when a month is clicked', () => {
      const handleMonthSelect = vi.fn()
      const props = createOptionsProps({ handleMonthSelect })

      render(<Options {...props} />)
      const monthItems = screen.getAllByText(/months\./)
      fireEvent.click(monthItems[0])

      expect(handleMonthSelect).toHaveBeenCalledWith(0)
    })

    it('should call handleYearSelect when a year is clicked', () => {
      const handleYearSelect = vi.fn()
      const props = createOptionsProps({ handleYearSelect })

      render(<Options {...props} />)
      fireEvent.click(screen.getByText('2024'))

      expect(handleYearSelect).toHaveBeenCalledWith(2024)
    })
  })

  describe('Selection', () => {
    it('should render selected month in the list', () => {
      const props = createOptionsProps({ selectedMonth: 0 })

      render(<Options {...props} />)

      const monthItems = screen.getAllByText(/months\./)
      expect(monthItems.length).toBeGreaterThan(0)
    })

    it('should render selected year in the list', () => {
      const props = createOptionsProps({ selectedYear: 2024 })

      render(<Options {...props} />)

      expect(screen.getByText('2024')).toBeInTheDocument()
    })
  })
})
