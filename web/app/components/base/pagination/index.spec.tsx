import { act, fireEvent, render, screen } from '@testing-library/react'
import CustomizedPagination from './index'

describe('CustomizedPagination', () => {
  const defaultProps = {
    current: 0,
    onChange: vi.fn(),
    total: 100,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<CustomizedPagination {...defaultProps} />)
      expect(container).toBeInTheDocument()
    })

    it('should display current page and total pages', () => {
      render(<CustomizedPagination {...defaultProps} current={0} total={100} limit={10} />)
      // current + 1 = 1, totalPages = 10
      // The page info display shows "1 / 10" and page buttons also show numbers
      expect(screen.getByText('/')).toBeInTheDocument()
      expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1)
    })

    it('should render prev and next buttons', () => {
      render(<CustomizedPagination {...defaultProps} />)
      const buttons = screen.getAllByRole('button')
      expect(buttons.length).toBeGreaterThanOrEqual(2)
    })

    it('should render page number buttons', () => {
      render(<CustomizedPagination {...defaultProps} total={50} limit={10} />)
      // 5 pages total, should see page numbers
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('should display slash separator between current page and total', () => {
      render(<CustomizedPagination {...defaultProps} />)
      expect(screen.getByText('/')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<CustomizedPagination {...defaultProps} className="my-custom" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('my-custom')
    })

    it('should default limit to 10', () => {
      render(<CustomizedPagination {...defaultProps} total={100} />)
      // totalPages = 100 / 10 = 10, displayed in the page info area
      expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(1)
    })

    it('should calculate total pages based on custom limit', () => {
      render(<CustomizedPagination {...defaultProps} total={100} limit={25} />)
      // totalPages = 100 / 25 = 4, displayed in the page info area
      expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1)
    })

    it('should disable prev button on first page', () => {
      render(<CustomizedPagination {...defaultProps} current={0} />)
      const buttons = screen.getAllByRole('button')
      // First button is prev
      expect(buttons[0]).toBeDisabled()
    })

    it('should disable next button on last page', () => {
      render(<CustomizedPagination {...defaultProps} current={9} total={100} limit={10} />)
      const buttons = screen.getAllByRole('button')
      // Last button is next
      expect(buttons[buttons.length - 1]).toBeDisabled()
    })

    it('should not render limit selector when onLimitChange is not provided', () => {
      render(<CustomizedPagination {...defaultProps} />)
      expect(screen.queryByText(/common\.pagination\.perPage/i)).not.toBeInTheDocument()
    })

    it('should render limit selector when onLimitChange is provided', () => {
      const onLimitChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} onLimitChange={onLimitChange} />)
      // Should show limit options 10, 25, 50
      expect(screen.getByText('25')).toBeInTheDocument()
      expect(screen.getByText('50')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when next button is clicked', () => {
      const onChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} current={0} onChange={onChange} />)
      const buttons = screen.getAllByRole('button')
      const nextButton = buttons[buttons.length - 1]
      fireEvent.click(nextButton)
      expect(onChange).toHaveBeenCalledWith(1)
    })

    it('should call onChange when prev button is clicked', () => {
      const onChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} current={5} onChange={onChange} />)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])
      expect(onChange).toHaveBeenCalledWith(4)
    })

    it('should show input when page display is clicked', () => {
      render(<CustomizedPagination {...defaultProps} />)
      // Click the current page display (the div containing "1 / 10")
      fireEvent.click(screen.getByText('/'))
      // Input should appear
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('should navigate to entered page on Enter key', () => {
      vi.useFakeTimers()
      const onChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} current={0} onChange={onChange} />)
      fireEvent.click(screen.getByText('/'))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '5' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(onChange).toHaveBeenCalledWith(4) // 0-indexed
    })

    it('should cancel input on Escape key', () => {
      render(<CustomizedPagination {...defaultProps} current={0} />)
      fireEvent.click(screen.getByText('/'))
      const input = screen.getByRole('textbox')
      fireEvent.keyDown(input, { key: 'Escape' })
      // Input should be hidden and page display should return
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.getByText('/')).toBeInTheDocument()
    })

    it('should confirm input on blur', () => {
      vi.useFakeTimers()
      const onChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} current={0} onChange={onChange} />)
      fireEvent.click(screen.getByText('/'))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '3' } })
      fireEvent.blur(input)
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(onChange).toHaveBeenCalledWith(2) // 0-indexed
    })

    it('should clamp page to max when input exceeds total pages', () => {
      vi.useFakeTimers()
      const onChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} current={0} total={100} limit={10} onChange={onChange} />)
      fireEvent.click(screen.getByText('/'))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '999' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(onChange).toHaveBeenCalledWith(9) // last page (0-indexed)
    })

    it('should clamp page to min when input is less than 1', () => {
      vi.useFakeTimers()
      const onChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} current={5} onChange={onChange} />)
      fireEvent.click(screen.getByText('/'))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '0' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(onChange).toHaveBeenCalledWith(0)
    })

    it('should ignore non-numeric input', () => {
      render(<CustomizedPagination {...defaultProps} />)
      fireEvent.click(screen.getByText('/'))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'abc' } })
      expect(input).toHaveValue('')
    })

    it('should call onLimitChange when limit option is clicked', () => {
      const onLimitChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} onLimitChange={onLimitChange} />)
      fireEvent.click(screen.getByText('25'))
      expect(onLimitChange).toHaveBeenCalledWith(25)
    })

    it('should call onLimitChange with 50 when 50 option is clicked', () => {
      const onLimitChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} onLimitChange={onLimitChange} />)
      fireEvent.click(screen.getByText('50'))
      expect(onLimitChange).toHaveBeenCalledWith(50)
    })

    it('should call onChange when a page button is clicked', () => {
      const onChange = vi.fn()
      render(<CustomizedPagination {...defaultProps} current={0} total={50} limit={10} onChange={onChange} />)
      fireEvent.click(screen.getByText('3'))
      expect(onChange).toHaveBeenCalledWith(2) // 0-indexed
    })
  })

  describe('Edge Cases', () => {
    it('should handle total of 0', () => {
      const { container } = render(<CustomizedPagination {...defaultProps} total={0} />)
      expect(container).toBeInTheDocument()
    })

    it('should handle single page', () => {
      render(<CustomizedPagination {...defaultProps} total={5} limit={10} />)
      // totalPages = 1, both buttons should be disabled
      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).toBeDisabled()
      expect(buttons[buttons.length - 1]).toBeDisabled()
    })

    it('should restore input value when blurred with empty value', () => {
      render(<CustomizedPagination {...defaultProps} current={4} />)
      fireEvent.click(screen.getByText('/'))
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.blur(input)
      // Should close input without calling onChange, restoring to current + 1
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })
  })
})
