import type { DatePickerFooterProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { ViewType } from '../types'
import Footer from './footer'

// Factory for Footer props
const createFooterProps = (overrides: Partial<DatePickerFooterProps> = {}): DatePickerFooterProps => ({
  needTimePicker: true,
  displayTime: '02:30 PM',
  view: ViewType.date,
  handleClickTimePicker: vi.fn(),
  handleSelectCurrentDate: vi.fn(),
  handleConfirmDate: vi.fn(),
  ...overrides,
})

describe('DatePicker Footer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests
  describe('Rendering', () => {
    it('should render Now button and confirm button', () => {
      const props = createFooterProps()
      render(<Footer {...props} />)

      expect(screen.getByText(/operation\.now/)).toBeInTheDocument()
      expect(screen.getByText(/operation\.ok/)).toBeInTheDocument()
    })

    it('should show time picker button when needTimePicker is true', () => {
      const props = createFooterProps({ needTimePicker: true, displayTime: '02:30 PM' })
      render(<Footer {...props} />)

      expect(screen.getByText('02:30 PM')).toBeInTheDocument()
    })

    it('should not show time picker button when needTimePicker is false', () => {
      const props = createFooterProps({ needTimePicker: false })
      render(<Footer {...props} />)

      expect(screen.queryByText('02:30 PM')).not.toBeInTheDocument()
    })
  })

  // View-dependent rendering tests
  describe('View States', () => {
    it('should show display time when view is date', () => {
      const props = createFooterProps({ view: ViewType.date, displayTime: '10:00 AM' })
      render(<Footer {...props} />)

      expect(screen.getByText('10:00 AM')).toBeInTheDocument()
    })

    it('should show pickDate text when view is time', () => {
      const props = createFooterProps({ view: ViewType.time })
      render(<Footer {...props} />)

      expect(screen.getByText(/operation\.pickDate/)).toBeInTheDocument()
    })
  })

  // Interaction tests
  describe('Interactions', () => {
    it('should call handleClickTimePicker when time picker button is clicked', () => {
      const handleClickTimePicker = vi.fn()
      const props = createFooterProps({ handleClickTimePicker })
      render(<Footer {...props} />)

      // Click the time picker toggle button (has the time display)
      fireEvent.click(screen.getByText('02:30 PM'))

      expect(handleClickTimePicker).toHaveBeenCalledTimes(1)
    })

    it('should call handleSelectCurrentDate when Now button is clicked', () => {
      const handleSelectCurrentDate = vi.fn()
      const props = createFooterProps({ handleSelectCurrentDate })
      render(<Footer {...props} />)

      fireEvent.click(screen.getByText(/operation\.now/))

      expect(handleSelectCurrentDate).toHaveBeenCalledTimes(1)
    })

    it('should call handleConfirmDate when OK button is clicked', () => {
      const handleConfirmDate = vi.fn()
      const props = createFooterProps({ handleConfirmDate })
      render(<Footer {...props} />)

      fireEvent.click(screen.getByText(/operation\.ok/))

      expect(handleConfirmDate).toHaveBeenCalledTimes(1)
    })
  })
})
