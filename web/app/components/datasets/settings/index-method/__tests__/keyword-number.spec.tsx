import { fireEvent, render, screen } from '@testing-library/react'
import KeyWordNumber from '../keyword-number'

describe('KeyWordNumber', () => {
  const defaultProps = {
    keywordNumber: 10,
    onKeywordNumberChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const getSlider = () => screen.getByLabelText('datasetSettings.form.numberOfKeywords')

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<KeyWordNumber {...defaultProps} />)
      expect(screen.getByText(/form\.numberOfKeywords/)).toBeInTheDocument()
    })

    it('should render label text', () => {
      render(<KeyWordNumber {...defaultProps} />)
      expect(screen.getByText(/form\.numberOfKeywords/)).toBeInTheDocument()
    })

    it('should render tooltip with question icon', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const container = screen.getByText(/form\.numberOfKeywords/).closest('div')?.parentElement
      const questionIcon = container?.querySelector('.i-ri-question-line')
      expect(questionIcon).toBeInTheDocument()
    })

    it('should render slider', () => {
      render(<KeyWordNumber {...defaultProps} />)
      expect(getSlider()).toBeInTheDocument()
    })

    it('should render input number field', () => {
      render(<KeyWordNumber {...defaultProps} />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display correct keywordNumber value in input', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={25} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('25')
    })

    it('should display different keywordNumber values', () => {
      const values = [1, 10, 25, 50]

      values.forEach((value) => {
        const { unmount } = render(<KeyWordNumber {...defaultProps} keywordNumber={value} />)
        const input = screen.getByRole('textbox')
        expect(input).toHaveValue(String(value))
        unmount()
      })
    })

    it('should pass correct value to slider', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={30} />)
      const slider = getSlider()
      expect(slider).toHaveAttribute('aria-valuenow', '30')
    })
  })

  describe('User Interactions', () => {
    it('should render slider that accepts onChange', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const slider = getSlider()
      expect(slider).toBeInTheDocument()
      expect(slider).not.toBeDisabled()
    })

    it('should call onKeywordNumberChange when input value changes', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '30' } })

      expect(handleChange).toHaveBeenCalled()
    })

    it('should reset to 0 when users clear the input', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: '' } })

      expect(handleChange).toHaveBeenCalledWith(0)
    })

    it('should clamp out-of-range edits before updating state', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '60' } })
      expect(handleChange).toHaveBeenLastCalledWith(50)
    })
  })

  describe('Slider Configuration', () => {
    it('should have max value of 50', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const slider = getSlider()
      expect(slider).toHaveAttribute('max', '50')
    })

    it('should have min value of 0', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const slider = getSlider()
      expect(slider).toHaveAttribute('min', '0')
    })
  })

  describe('Edge Cases', () => {
    it('should handle minimum value (0)', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={0} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('0')
    })

    it('should handle maximum value (50)', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={50} />)
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('50')
    })

    it('should handle value updates correctly', () => {
      const { rerender } = render(<KeyWordNumber {...defaultProps} keywordNumber={10} />)

      let input = screen.getByRole('textbox')
      expect(input).toHaveValue('10')

      rerender(<KeyWordNumber {...defaultProps} keywordNumber={25} />)
      input = screen.getByRole('textbox')
      expect(input).toHaveValue('25')
    })

    it('should handle rapid value changes', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const input = screen.getByRole('textbox')

      // Simulate rapid changes via input with different values
      fireEvent.change(input, { target: { value: '15' } })
      fireEvent.change(input, { target: { value: '25' } })
      fireEvent.change(input, { target: { value: '35' } })

      expect(handleChange).toHaveBeenCalledTimes(3)
    })
  })

  describe('Accessibility', () => {
    it('should have accessible slider', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const slider = getSlider()
      expect(slider).toBeInTheDocument()
    })

    it('should have accessible input', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const input = screen.getByRole('textbox')
      expect(input).toBeInTheDocument()
    })
  })
})
