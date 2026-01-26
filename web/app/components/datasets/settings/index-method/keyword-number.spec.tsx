import { fireEvent, render, screen } from '@testing-library/react'
import KeyWordNumber from './keyword-number'

// Note: react-i18next is globally mocked in vitest.setup.ts

describe('KeyWordNumber', () => {
  const defaultProps = {
    keywordNumber: 10,
    onKeywordNumberChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

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
      // RiQuestionLine renders as an svg
      const container = screen.getByText(/form\.numberOfKeywords/).closest('div')?.parentElement
      const questionIcon = container?.querySelector('svg')
      expect(questionIcon).toBeInTheDocument()
    })

    it('should render slider', () => {
      render(<KeyWordNumber {...defaultProps} />)
      // Slider has a slider role
      expect(screen.getByRole('slider')).toBeInTheDocument()
    })

    it('should render input number field', () => {
      render(<KeyWordNumber {...defaultProps} />)
      expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should display correct keywordNumber value in input', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={25} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(25)
    })

    it('should display different keywordNumber values', () => {
      const values = [1, 10, 25, 50]

      values.forEach((value) => {
        const { unmount } = render(<KeyWordNumber {...defaultProps} keywordNumber={value} />)
        const input = screen.getByRole('spinbutton')
        expect(input).toHaveValue(value)
        unmount()
      })
    })

    it('should pass correct value to slider', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={30} />)
      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('aria-valuenow', '30')
    })
  })

  describe('User Interactions', () => {
    it('should render slider that accepts onChange', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const slider = screen.getByRole('slider')
      // Verify slider is rendered and interactive
      expect(slider).toBeInTheDocument()
      expect(slider).not.toBeDisabled()
    })

    it('should call onKeywordNumberChange when input value changes', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const input = screen.getByRole('spinbutton')
      fireEvent.change(input, { target: { value: '30' } })

      expect(handleChange).toHaveBeenCalled()
    })

    it('should not call onKeywordNumberChange with undefined value', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const input = screen.getByRole('spinbutton')
      fireEvent.change(input, { target: { value: '' } })

      // When value is empty/undefined, handleInputChange should not call onKeywordNumberChange
      expect(handleChange).not.toHaveBeenCalled()
    })
  })

  describe('Slider Configuration', () => {
    it('should have max value of 50', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('aria-valuemax', '50')
    })

    it('should have min value of 0', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const slider = screen.getByRole('slider')
      expect(slider).toHaveAttribute('aria-valuemin', '0')
    })
  })

  describe('Edge Cases', () => {
    it('should handle minimum value (0)', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={0} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(0)
    })

    it('should handle maximum value (50)', () => {
      render(<KeyWordNumber {...defaultProps} keywordNumber={50} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(50)
    })

    it('should handle value updates correctly', () => {
      const { rerender } = render(<KeyWordNumber {...defaultProps} keywordNumber={10} />)

      let input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(10)

      rerender(<KeyWordNumber {...defaultProps} keywordNumber={25} />)
      input = screen.getByRole('spinbutton')
      expect(input).toHaveValue(25)
    })

    it('should handle rapid value changes', () => {
      const handleChange = vi.fn()
      render(<KeyWordNumber {...defaultProps} onKeywordNumberChange={handleChange} />)

      const input = screen.getByRole('spinbutton')

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
      const slider = screen.getByRole('slider')
      expect(slider).toBeInTheDocument()
    })

    it('should have accessible input', () => {
      render(<KeyWordNumber {...defaultProps} />)
      const input = screen.getByRole('spinbutton')
      expect(input).toBeInTheDocument()
    })
  })
})
