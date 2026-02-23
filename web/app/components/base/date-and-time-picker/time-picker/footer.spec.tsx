import type { TimePickerFooterProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import Footer from './footer'

// Factory for TimePickerFooter props
const createFooterProps = (overrides: Partial<TimePickerFooterProps> = {}): TimePickerFooterProps => ({
  handleSelectCurrentTime: vi.fn(),
  handleConfirm: vi.fn(),
  ...overrides,
})

describe('TimePicker Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render Now and OK buttons', () => {
      const props = createFooterProps()
      render(<Footer {...props} />)

      expect(screen.getByText(/operation\.now/)).toBeInTheDocument()
      expect(screen.getByText(/operation\.ok/)).toBeInTheDocument()
    })
  })

  // Interaction tests
  describe('Interactions', () => {
    it('should call handleSelectCurrentTime when Now button is clicked', () => {
      const handleSelectCurrentTime = vi.fn()
      const props = createFooterProps({ handleSelectCurrentTime })
      render(<Footer {...props} />)

      fireEvent.click(screen.getByText(/operation\.now/))

      expect(handleSelectCurrentTime).toHaveBeenCalledTimes(1)
    })

    it('should call handleConfirm when OK button is clicked', () => {
      const handleConfirm = vi.fn()
      const props = createFooterProps({ handleConfirm })
      render(<Footer {...props} />)

      fireEvent.click(screen.getByText(/operation\.ok/))

      expect(handleConfirm).toHaveBeenCalledTimes(1)
    })
  })
})
