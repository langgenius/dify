import type { DatePickerHeaderProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import dayjs from '../utils/dayjs'
import Header from './header'

// Factory for Header props
const createHeaderProps = (overrides: Partial<DatePickerHeaderProps> = {}): DatePickerHeaderProps => ({
  handleOpenYearMonthPicker: vi.fn(),
  currentDate: dayjs('2024-06-15'),
  onClickNextMonth: vi.fn(),
  onClickPrevMonth: vi.fn(),
  ...overrides,
})

describe('DatePicker Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render month and year display', () => {
      const props = createHeaderProps({ currentDate: dayjs('2024-06-15') })
      render(<Header {...props} />)

      // The useMonths hook returns translated keys; check for year
      expect(screen.getByText(/2024/)).toBeInTheDocument()
    })

    it('should render navigation buttons', () => {
      const props = createHeaderProps()
      render(<Header {...props} />)

      // There are 3 buttons: month/year display, prev, next
      const buttons = screen.getAllByRole('button')
      expect(buttons).toHaveLength(3)
    })
  })

  // Interaction tests
  describe('Interactions', () => {
    it('should call handleOpenYearMonthPicker when month/year button is clicked', () => {
      const handleOpenYearMonthPicker = vi.fn()
      const props = createHeaderProps({ handleOpenYearMonthPicker })
      render(<Header {...props} />)

      // First button is the month/year display
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      expect(handleOpenYearMonthPicker).toHaveBeenCalledTimes(1)
    })

    it('should call onClickPrevMonth when previous button is clicked', () => {
      const onClickPrevMonth = vi.fn()
      const props = createHeaderProps({ onClickPrevMonth })
      render(<Header {...props} />)

      // Second button is prev month
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[1])

      expect(onClickPrevMonth).toHaveBeenCalledTimes(1)
    })

    it('should call onClickNextMonth when next button is clicked', () => {
      const onClickNextMonth = vi.fn()
      const props = createHeaderProps({ onClickNextMonth })
      render(<Header {...props} />)

      // Third button is next month
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[2])

      expect(onClickNextMonth).toHaveBeenCalledTimes(1)
    })
  })
})
