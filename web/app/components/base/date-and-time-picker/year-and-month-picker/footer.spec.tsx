import type { YearAndMonthPickerFooterProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import Footer from './footer'

// Factory for Footer props
const createFooterProps = (overrides: Partial<YearAndMonthPickerFooterProps> = {}): YearAndMonthPickerFooterProps => ({
  handleYearMonthCancel: vi.fn(),
  handleYearMonthConfirm: vi.fn(),
  ...overrides,
})

describe('YearAndMonthPicker Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render Cancel and OK buttons', () => {
      const props = createFooterProps()
      render(<Footer {...props} />)

      expect(screen.getByText(/operation\.cancel/)).toBeInTheDocument()
      expect(screen.getByText(/operation\.ok/)).toBeInTheDocument()
    })
  })

  // Interaction tests
  describe('Interactions', () => {
    it('should call handleYearMonthCancel when Cancel button is clicked', () => {
      const handleYearMonthCancel = vi.fn()
      const props = createFooterProps({ handleYearMonthCancel })
      render(<Footer {...props} />)

      fireEvent.click(screen.getByText(/operation\.cancel/))

      expect(handleYearMonthCancel).toHaveBeenCalledTimes(1)
    })

    it('should call handleYearMonthConfirm when OK button is clicked', () => {
      const handleYearMonthConfirm = vi.fn()
      const props = createFooterProps({ handleYearMonthConfirm })
      render(<Footer {...props} />)

      fireEvent.click(screen.getByText(/operation\.ok/))

      expect(handleYearMonthConfirm).toHaveBeenCalledTimes(1)
    })
  })
})
