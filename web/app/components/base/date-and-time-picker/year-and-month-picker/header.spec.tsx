import type { YearAndMonthPickerHeaderProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import Header from './header'

// Factory for Header props
const createHeaderProps = (overrides: Partial<YearAndMonthPickerHeaderProps> = {}): YearAndMonthPickerHeaderProps => ({
  selectedYear: 2024,
  selectedMonth: 5, // June (0-indexed)
  onClick: vi.fn(),
  ...overrides,
})

describe('YearAndMonthPicker Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should display the selected year', () => {
      const props = createHeaderProps({ selectedYear: 2024 })
      render(<Header {...props} />)

      expect(screen.getByText(/2024/)).toBeInTheDocument()
    })

    it('should render a clickable button', () => {
      const props = createHeaderProps()
      render(<Header {...props} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  // Interaction tests
  describe('Interactions', () => {
    it('should call onClick when the header button is clicked', () => {
      const onClick = vi.fn()
      const props = createHeaderProps({ onClick })
      render(<Header {...props} />)

      fireEvent.click(screen.getByRole('button'))

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })
})
