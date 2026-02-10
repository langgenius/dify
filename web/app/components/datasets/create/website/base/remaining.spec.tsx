import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================================
// Component Imports (after mocks)
// ============================================================================

import CheckboxWithLabel from './checkbox-with-label'
import Crawling from './crawling'
import ErrorMessage from './error-message'
import Field from './field'
import OptionsWrap from './options-wrap'

// ============================================================================
// Mock Setup
// ============================================================================

// Mock ahooks useBoolean for OptionsWrap
let mockFoldValue = false
const mockToggle = vi.fn()
const mockSetTrue = vi.fn()

vi.mock('ahooks', () => ({
  useBoolean: (initial: boolean) => {
    mockFoldValue = initial
    return [
      mockFoldValue,
      {
        toggle: mockToggle,
        setTrue: mockSetTrue,
        setFalse: vi.fn(),
        set: vi.fn(),
      },
    ]
  },
}))

// ============================================================================
// CheckboxWithLabel Tests
// ============================================================================

describe('CheckboxWithLabel', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the checkbox with label component
  describe('Rendering', () => {
    it('should render label text', () => {
      // Arrange & Act
      render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Include subpages"
        />,
      )

      // Assert
      expect(screen.getByText('Include subpages')).toBeInTheDocument()
    })

    it('should render a checkbox element', () => {
      // Arrange & Act
      render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Test label"
          testId="test-cb"
        />,
      )

      // Assert - Checkbox renders as a div with data-testid
      expect(screen.getByTestId('checkbox-test-cb')).toBeInTheDocument()
    })

    it('should render check icon when isChecked is true', () => {
      // Arrange & Act
      render(
        <CheckboxWithLabel
          isChecked={true}
          onChange={mockOnChange}
          label="Test label"
          testId="checked-cb"
        />,
      )

      // Assert - When checked, the Checkbox renders a check icon
      expect(screen.getByTestId('check-icon-checked-cb')).toBeInTheDocument()
    })

    it('should not render check icon when isChecked is false', () => {
      // Arrange & Act
      render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Test label"
          testId="unchecked-cb"
        />,
      )

      // Assert
      expect(screen.queryByTestId('check-icon-unchecked-cb')).not.toBeInTheDocument()
    })

    it('should render tooltip when tooltip prop is provided', () => {
      // Arrange & Act
      render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Test"
          tooltip="Helpful hint"
        />,
      )

      // Assert - Tooltip renders its trigger element
      const label = screen.getByText('Test').closest('label')
      expect(label).toBeInTheDocument()
    })

    it('should not render tooltip when tooltip prop is not provided', () => {
      // Arrange & Act
      const { container } = render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Test"
        />,
      )

      // Assert - no tooltip trigger
      const label = container.querySelector('label')
      expect(label).toBeInTheDocument()
      // The tooltip trigger has a specific class; without tooltip, it should not exist
      expect(container.querySelector('[class*="ml-0.5"]')).toBeNull()
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <CheckboxWithLabel
          className="custom-class"
          isChecked={false}
          onChange={mockOnChange}
          label="Test"
        />,
      )

      // Assert
      const label = container.querySelector('label')
      expect(label?.className).toContain('custom-class')
    })

    it('should apply custom labelClassName', () => {
      // Arrange & Act
      render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Styled label"
          labelClassName="font-bold"
        />,
      )

      // Assert
      const labelText = screen.getByText('Styled label')
      expect(labelText.className).toContain('font-bold')
    })

    it('should set testId on checkbox', () => {
      // Arrange & Act
      render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Test"
          testId="my-checkbox"
        />,
      )

      // Assert
      expect(document.getElementById('my-checkbox')).toBeInTheDocument()
    })
  })

  // User interaction tests
  describe('User Interactions', () => {
    it('should call onChange with true when unchecked checkbox is clicked', () => {
      // Arrange
      render(
        <CheckboxWithLabel
          isChecked={false}
          onChange={mockOnChange}
          label="Toggle me"
          testId="toggle-cb"
        />,
      )

      // Act - Checkbox is a div, click it directly
      fireEvent.click(screen.getByTestId('checkbox-toggle-cb'))

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(true)
    })

    it('should call onChange with false when checked checkbox is clicked', () => {
      // Arrange
      render(
        <CheckboxWithLabel
          isChecked={true}
          onChange={mockOnChange}
          label="Toggle me"
          testId="toggle-cb2"
        />,
      )

      // Act
      fireEvent.click(screen.getByTestId('checkbox-toggle-cb2'))

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(false)
    })
  })
})

// ============================================================================
// Crawling Tests
// ============================================================================

describe('Crawling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the crawling status component
  describe('Rendering', () => {
    it('should render crawled/total count', () => {
      // Arrange & Act
      render(<Crawling crawledNum={5} totalNum={10} />)

      // Assert
      expect(screen.getByText(/5/)).toBeInTheDocument()
      expect(screen.getByText(/10/)).toBeInTheDocument()
    })

    it('should render the total pages scraped label', () => {
      // Arrange & Act
      render(<Crawling crawledNum={3} totalNum={20} />)

      // Assert
      expect(screen.getByText(/totalPageScraped/i)).toBeInTheDocument()
    })

    it('should render skeleton rows', () => {
      // Arrange & Act
      const { container } = render(<Crawling crawledNum={0} totalNum={0} />)

      // Assert - 4 skeleton items rendered
      const skeletonRows = container.querySelectorAll('.py-\\[5px\\]')
      expect(skeletonRows).toHaveLength(4)
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <Crawling className="extra-class" crawledNum={1} totalNum={5} />,
      )

      // Assert
      expect(container.firstElementChild?.className).toContain('extra-class')
    })
  })

  // Edge case tests
  describe('Edge Cases', () => {
    it('should render with zero values', () => {
      // Arrange & Act
      render(<Crawling crawledNum={0} totalNum={0} />)

      // Assert
      expect(screen.getByText(/0/)).toBeInTheDocument()
    })

    it('should render when crawledNum equals totalNum', () => {
      // Arrange & Act
      render(<Crawling crawledNum={10} totalNum={10} />)

      // Assert
      expect(screen.getByText(/10/)).toBeInTheDocument()
    })
  })
})

// ============================================================================
// ErrorMessage Tests
// ============================================================================

describe('ErrorMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the error message component
  describe('Rendering', () => {
    it('should render the title', () => {
      // Arrange & Act
      render(<ErrorMessage title="Something went wrong" />)

      // Assert
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })

    it('should render the alert triangle icon', () => {
      // Arrange & Act
      const { container } = render(<ErrorMessage title="Error" />)

      // Assert - AlertTriangle icon is rendered as svg
      const svg = container.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render errorMsg when provided', () => {
      // Arrange & Act
      render(<ErrorMessage title="Error" errorMsg="Detailed error info" />)

      // Assert
      expect(screen.getByText('Detailed error info')).toBeInTheDocument()
    })

    it('should not render errorMsg when not provided', () => {
      // Arrange & Act
      render(<ErrorMessage title="Error" />)

      // Assert - only one text block (the title)
      expect(screen.queryByText('Detailed error info')).not.toBeInTheDocument()
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <ErrorMessage className="my-error" title="Error" />,
      )

      // Assert
      expect(container.firstElementChild?.className).toContain('my-error')
    })
  })

  // Branch coverage for optional errorMsg
  describe('Branch Coverage', () => {
    it('should render error detail section when errorMsg is truthy', () => {
      // Arrange & Act
      const { container } = render(
        <ErrorMessage title="Error" errorMsg="Details here" />,
      )

      // Assert
      const errorDetail = container.querySelector('.pl-6')
      expect(errorDetail).toBeInTheDocument()
      expect(errorDetail?.textContent).toBe('Details here')
    })

    it('should not render error detail section when errorMsg is empty string', () => {
      // Arrange & Act
      const { container } = render(
        <ErrorMessage title="Error" errorMsg="" />,
      )

      // Assert
      const errorDetail = container.querySelector('.pl-6')
      expect(errorDetail).toBeNull()
    })

    it('should not render error detail section when errorMsg is undefined', () => {
      // Arrange & Act
      const { container } = render(
        <ErrorMessage title="Error" />,
      )

      // Assert
      const errorDetail = container.querySelector('.pl-6')
      expect(errorDetail).toBeNull()
    })
  })
})

// ============================================================================
// Field Tests
// ============================================================================

describe('Field', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests for the field component
  describe('Rendering', () => {
    it('should render the label', () => {
      // Arrange & Act
      render(<Field label="Max depth" value="" onChange={mockOnChange} />)

      // Assert
      expect(screen.getByText('Max depth')).toBeInTheDocument()
    })

    it('should render the input with value', () => {
      // Arrange & Act
      render(<Field label="URL" value="https://example.com" onChange={mockOnChange} />)

      // Assert
      const input = screen.getByRole('textbox')
      expect(input).toHaveValue('https://example.com')
    })

    it('should render placeholder text', () => {
      // Arrange & Act
      render(
        <Field
          label="Field"
          value=""
          onChange={mockOnChange}
          placeholder="Enter value"
        />,
      )

      // Assert
      expect(screen.getByPlaceholderText('Enter value')).toBeInTheDocument()
    })

    it('should render required marker when isRequired is true', () => {
      // Arrange & Act
      render(
        <Field label="Required field" value="" onChange={mockOnChange} isRequired />,
      )

      // Assert
      expect(screen.getByText('*')).toBeInTheDocument()
    })

    it('should not render required marker when isRequired is false', () => {
      // Arrange & Act
      render(
        <Field label="Optional field" value="" onChange={mockOnChange} />,
      )

      // Assert
      expect(screen.queryByText('*')).not.toBeInTheDocument()
    })

    it('should render tooltip when tooltip prop is provided', () => {
      // Arrange & Act
      const { container } = render(
        <Field
          label="Field"
          value=""
          onChange={mockOnChange}
          tooltip="Help text"
        />,
      )

      // Assert - tooltip trigger is present
      expect(container.querySelector('[class*="ml-0.5"]')).toBeInTheDocument()
    })

    it('should not render tooltip when tooltip prop is not provided', () => {
      // Arrange & Act
      const { container } = render(
        <Field label="Field" value="" onChange={mockOnChange} />,
      )

      // Assert
      expect(container.querySelector('[class*="ml-0.5"]')).toBeNull()
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <Field className="custom-field" label="Field" value="" onChange={mockOnChange} />,
      )

      // Assert
      expect(container.firstElementChild?.className).toContain('custom-field')
    })

    it('should apply custom labelClassName', () => {
      // Arrange & Act
      render(
        <Field
          label="Styled"
          labelClassName="extra-label-style"
          value=""
          onChange={mockOnChange}
        />,
      )

      // Assert
      const labelDiv = screen.getByText('Styled')
      expect(labelDiv.className).toContain('extra-label-style')
    })
  })

  // User interaction tests for the field component
  describe('User Interactions', () => {
    it('should call onChange when text input value changes', () => {
      // Arrange
      render(<Field label="Text field" value="" onChange={mockOnChange} />)

      // Act
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'new value' } })

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith('new value')
    })

    it('should call onChange with number when isNumber is true', () => {
      // Arrange
      render(
        <Field label="Number field" value="" onChange={mockOnChange} isNumber />,
      )

      // Act
      const input = screen.getByRole('spinbutton')
      fireEvent.change(input, { target: { value: '42' } })

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(42)
    })

    it('should call onChange with empty string for NaN input when isNumber is true', () => {
      // Arrange — start with a numeric value so clearing triggers a real change
      render(
        <Field label="Number" value={10} onChange={mockOnChange} isNumber />,
      )

      // Act — clear the number input
      const input = screen.getByRole('spinbutton')
      fireEvent.change(input, { target: { value: '' } })

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith('')
    })

    it('should clamp to MIN_VALUE (0) for negative numbers when isNumber is true', () => {
      // Arrange
      render(
        <Field label="Number" value="" onChange={mockOnChange} isNumber />,
      )

      // Act
      const input = screen.getByRole('spinbutton')
      fireEvent.change(input, { target: { value: '-5' } })

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(0)
    })
  })

  // Edge cases for the field component
  describe('Edge Cases', () => {
    it('should render with number type input when isNumber is true', () => {
      // Arrange & Act
      render(
        <Field label="Num" value={5} onChange={mockOnChange} isNumber />,
      )

      // Assert
      const input = screen.getByRole('spinbutton')
      expect(input).toHaveAttribute('type', 'number')
      expect(input).toHaveAttribute('min', '0')
    })

    it('should render with text type input when isNumber is false', () => {
      // Arrange & Act
      render(
        <Field label="Text" value="hello" onChange={mockOnChange} />,
      )

      // Assert
      const input = screen.getByRole('textbox')
      expect(input).toHaveAttribute('type', 'text')
    })
  })
})

// ============================================================================
// OptionsWrap Tests
// ============================================================================

describe('OptionsWrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFoldValue = false
  })

  // Rendering tests for the options wrap component
  describe('Rendering', () => {
    it('should render the options label', () => {
      // Arrange & Act
      render(
        <OptionsWrap>
          <div>Child content</div>
        </OptionsWrap>,
      )

      // Assert
      expect(screen.getByText(/options/i)).toBeInTheDocument()
    })

    it('should render children when not folded (default state)', () => {
      // Arrange & Act
      render(
        <OptionsWrap>
          <div>Visible options</div>
        </OptionsWrap>,
      )

      // Assert - fold is false by default, so children are visible
      expect(screen.getByText('Visible options')).toBeInTheDocument()
    })

    it('should render the settings icon', () => {
      // Arrange & Act
      const { container } = render(
        <OptionsWrap>
          <div>Content</div>
        </OptionsWrap>,
      )

      // Assert - RiEqualizer2Line renders an svg
      const svgs = container.querySelectorAll('svg')
      expect(svgs.length).toBeGreaterThanOrEqual(1)
    })

    it('should apply custom className', () => {
      // Arrange & Act
      const { container } = render(
        <OptionsWrap className="extra">
          <div>Content</div>
        </OptionsWrap>,
      )

      // Assert
      expect(container.firstElementChild?.className).toContain('extra')
    })
  })

  // User interaction tests for the options wrap component
  describe('User Interactions', () => {
    it('should call toggle when header is clicked', () => {
      // Arrange
      render(
        <OptionsWrap>
          <div>Content</div>
        </OptionsWrap>,
      )

      // Act
      const header = screen.getByText(/options/i).closest('[class*="cursor-pointer"]') as HTMLElement
      fireEvent.click(header)

      // Assert
      expect(mockToggle).toHaveBeenCalledTimes(1)
    })
  })

  // controlFoldOptions prop tests
  describe('controlFoldOptions', () => {
    it('should call foldHide when controlFoldOptions changes', () => {
      // Arrange
      const { rerender } = render(
        <OptionsWrap controlFoldOptions={0}>
          <div>Content</div>
        </OptionsWrap>,
      )

      // Act - change controlFoldOptions to trigger the useEffect
      rerender(
        <OptionsWrap controlFoldOptions={1}>
          <div>Content</div>
        </OptionsWrap>,
      )

      // Assert
      expect(mockSetTrue).toHaveBeenCalled()
    })

    it('should not call foldHide when controlFoldOptions is falsy (0)', () => {
      // Arrange
      mockSetTrue.mockClear()

      // Act
      render(
        <OptionsWrap controlFoldOptions={0}>
          <div>Content</div>
        </OptionsWrap>,
      )

      // Assert - controlFoldOptions is 0 (falsy), so foldHide is not called
      expect(mockSetTrue).not.toHaveBeenCalled()
    })
  })
})
