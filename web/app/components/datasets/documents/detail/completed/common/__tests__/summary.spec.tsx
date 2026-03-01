import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SummaryLabel from '../summary-label'
import SummaryStatus from '../summary-status'
import SummaryText from '../summary-text'

describe('SummaryLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verifies the component renders with its heading and summary text
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SummaryLabel />)
      expect(screen.getByText(/segment\.summary/)).toBeInTheDocument()
    })

    it('should render the summary heading with divider', () => {
      render(<SummaryLabel summary="Test summary" />)
      expect(screen.getByText(/segment\.summary/)).toBeInTheDocument()
    })

    it('should render summary text when provided', () => {
      render(<SummaryLabel summary="My summary content" />)
      expect(screen.getByText('My summary content')).toBeInTheDocument()
    })
  })

  // Props: tests different prop combinations
  describe('Props', () => {
    it('should apply custom className', () => {
      const { container } = render(<SummaryLabel summary="test" className="custom-class" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('custom-class')
      expect(wrapper).toHaveClass('space-y-1')
    })

    it('should render without className prop', () => {
      const { container } = render(<SummaryLabel summary="test" />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('space-y-1')
    })
  })

  // Edge Cases: tests undefined/empty/special values
  describe('Edge Cases', () => {
    it('should handle undefined summary', () => {
      render(<SummaryLabel />)
      // Heading should still render
      expect(screen.getByText(/segment\.summary/)).toBeInTheDocument()
    })

    it('should handle empty string summary', () => {
      render(<SummaryLabel summary="" />)
      expect(screen.getByText(/segment\.summary/)).toBeInTheDocument()
    })

    it('should handle summary with special characters', () => {
      const summary = '<b>bold</b> & "quotes"'
      render(<SummaryLabel summary={summary} />)
      expect(screen.getByText(summary)).toBeInTheDocument()
    })

    it('should handle very long summary', () => {
      const longSummary = 'A'.repeat(1000)
      render(<SummaryLabel summary={longSummary} />)
      expect(screen.getByText(longSummary)).toBeInTheDocument()
    })

    it('should handle both className and summary as undefined', () => {
      const { container } = render(<SummaryLabel />)
      const wrapper = container.firstChild as HTMLElement
      expect(wrapper).toHaveClass('space-y-1')
    })
  })
})

describe('SummaryStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verifies badge rendering based on status
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SummaryStatus status="COMPLETED" />)
      // Should not crash even for non-SUMMARIZING status
    })

    it('should render badge when status is SUMMARIZING', () => {
      render(<SummaryStatus status="SUMMARIZING" />)
      expect(screen.getByText(/list\.summary\.generating/)).toBeInTheDocument()
    })

    it('should not render badge when status is not SUMMARIZING', () => {
      render(<SummaryStatus status="COMPLETED" />)
      expect(screen.queryByText(/list\.summary\.generating/)).not.toBeInTheDocument()
    })
  })

  // Props: tests tooltip content based on status
  describe('Props', () => {
    it('should show tooltip with generating summary message when SUMMARIZING', () => {
      render(<SummaryStatus status="SUMMARIZING" />)
      // The tooltip popupContent is set to the i18n key for generatingSummary
      expect(screen.getByText(/list\.summary\.generating/)).toBeInTheDocument()
    })
  })

  // Edge Cases: tests different status values
  describe('Edge Cases', () => {
    it('should not render badge for empty string status', () => {
      render(<SummaryStatus status="" />)
      expect(screen.queryByText(/list\.summary\.generating/)).not.toBeInTheDocument()
    })

    it('should not render badge for lowercase summarizing', () => {
      render(<SummaryStatus status="summarizing" />)
      expect(screen.queryByText(/list\.summary\.generating/)).not.toBeInTheDocument()
    })

    it('should not render badge for DONE status', () => {
      render(<SummaryStatus status="DONE" />)
      expect(screen.queryByText(/list\.summary\.generating/)).not.toBeInTheDocument()
    })

    it('should not render badge for FAILED status', () => {
      render(<SummaryStatus status="FAILED" />)
      expect(screen.queryByText(/list\.summary\.generating/)).not.toBeInTheDocument()
    })
  })
})

describe('SummaryText', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering: verifies the label and textarea render correctly
  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<SummaryText />)
      expect(screen.getByText(/segment\.summary/)).toBeInTheDocument()
    })

    it('should render the summary label', () => {
      render(<SummaryText value="hello" />)
      expect(screen.getByText(/segment\.summary/)).toBeInTheDocument()
    })

    it('should render textarea with placeholder', () => {
      render(<SummaryText />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeInTheDocument()
      expect(textarea).toHaveAttribute('placeholder', expect.stringContaining('segment.summaryPlaceholder'))
    })
  })

  // Props: tests value, onChange, and disabled behavior
  describe('Props', () => {
    it('should display the value prop in textarea', () => {
      render(<SummaryText value="My summary" />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('My summary')
    })

    it('should display empty string when value is undefined', () => {
      render(<SummaryText />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('')
    })

    it('should call onChange when textarea value changes', () => {
      const onChange = vi.fn()
      render(<SummaryText value="" onChange={onChange} />)
      const textarea = screen.getByRole('textbox')

      fireEvent.change(textarea, { target: { value: 'new value' } })

      expect(onChange).toHaveBeenCalledWith('new value')
    })

    it('should disable textarea when disabled is true', () => {
      render(<SummaryText value="test" disabled={true} />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeDisabled()
    })

    it('should enable textarea when disabled is false', () => {
      render(<SummaryText value="test" disabled={false} />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).not.toBeDisabled()
    })

    it('should enable textarea when disabled is undefined', () => {
      render(<SummaryText value="test" />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).not.toBeDisabled()
    })
  })

  // Edge Cases: tests missing onChange and edge value scenarios
  describe('Edge Cases', () => {
    it('should not throw when onChange is undefined and user types', () => {
      render(<SummaryText value="" />)
      const textarea = screen.getByRole('textbox')
      expect(() => {
        fireEvent.change(textarea, { target: { value: 'typed' } })
      }).not.toThrow()
    })

    it('should handle empty string value', () => {
      render(<SummaryText value="" />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue('')
    })

    it('should handle very long value', () => {
      const longValue = 'B'.repeat(5000)
      render(<SummaryText value={longValue} />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue(longValue)
    })

    it('should handle value with special characters', () => {
      const special = '<script>alert("x")</script>'
      render(<SummaryText value={special} />)
      const textarea = screen.getByRole('textbox')
      expect(textarea).toHaveValue(special)
    })
  })
})
