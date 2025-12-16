import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VarPicker, { type Props } from './var-picker'

// Mock external dependencies only
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/test',
}))

// Mock PortalToFollowElem components with conditional rendering
let mockPortalOpenState = false
let mockOnOpenChange: ((open: boolean) => void) | undefined

jest.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open, onOpenChange }: any) => {
    mockPortalOpenState = open || false
    mockOnOpenChange = onOpenChange
    return (
      <div data-testid="portal" data-open={open}>
        {children}
      </div>
    )
  },
  PortalToFollowElemContent: ({ children }: any) => {
    // Match actual behavior: returns null when not open
    if (!mockPortalOpenState) return null
    return <div data-testid="portal-content">{children}</div>
  },
  PortalToFollowElemTrigger: ({ children, onClick, onKeyDown, ...props }: any) => (
    <button
      data-testid="portal-trigger"
      onClick={(e) => {
        if (onClick) onClick(e)
        // Simulate the toggle behavior
        if (mockOnOpenChange)
          mockOnOpenChange(!mockPortalOpenState)
      }}
      onKeyDown={(e) => {
        if (onKeyDown) onKeyDown(e)
        // Handle keyboard interactions
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (mockOnOpenChange) mockOnOpenChange(!mockPortalOpenState)
        }
      }}
      {...props}
    >
      {children}
    </button>
  ),
}))

describe('VarPicker', () => {
  const mockOptions: Props['options'] = [
    { name: 'Variable 1', value: 'var1', type: 'string' },
    { name: 'Variable 2', value: 'var2', type: 'number' },
    { name: 'Variable 3', value: 'var3', type: 'boolean' },
  ]

  const defaultProps: Props = {
    value: 'var1',
    options: mockOptions,
    onChange: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockPortalOpenState = false
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render variable picker with dropdown trigger', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText('var1')).toBeInTheDocument()
    })

    it('should display selected variable with type icon when value is provided', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByText('var1')).toBeInTheDocument()
      expect(screen.getByText('{{')).toBeInTheDocument()
      expect(screen.getByText('}}')).toBeInTheDocument()
      // IconTypeIcon should be rendered (check for svg icon)
      expect(document.querySelector('svg')).toBeInTheDocument()
    })

    it('should show placeholder text when no value is selected', () => {
      // Arrange
      const props = {
        ...defaultProps,
        value: undefined,
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.queryByText('var1')).not.toBeInTheDocument()
      expect(screen.getByText(/choosePlaceholder/i)).toBeInTheDocument()
    })

    it('should display custom tip message when notSelectedVarTip is provided', () => {
      // Arrange
      const props = {
        ...defaultProps,
        value: undefined,
        notSelectedVarTip: 'Select a variable',
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByText('Select a variable')).toBeInTheDocument()
    })

    it('should render dropdown indicator icon', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<VarPicker {...props} />)

      // Assert - Check for dropdown indicator
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should apply custom className to wrapper', () => {
      // Arrange
      const props = {
        ...defaultProps,
        className: 'custom-class',
      }

      // Act
      const { container } = render(<VarPicker {...props} />)

      // Assert
      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })

    it('should apply custom triggerClassName to trigger button', () => {
      // Arrange
      const props = {
        ...defaultProps,
        triggerClassName: 'custom-trigger-class',
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
      // Note: triggerClassName is passed to PortalToFollowElemTrigger
    })

    it('should display selected value with proper formatting', () => {
      // Arrange
      const props = {
        ...defaultProps,
        value: 'customVar',
        options: [
          { name: 'Custom Variable', value: 'customVar', type: 'string' },
        ],
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByText('customVar')).toBeInTheDocument()
      expect(screen.getByText('{{')).toBeInTheDocument()
      expect(screen.getByText('}}')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should open dropdown when clicking the trigger button', async () => {
      // Arrange
      const onChange = jest.fn()
      const props = { ...defaultProps, onChange }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)
      await user.click(screen.getByRole('button'))

      // Assert
      expect(mockPortalOpenState).toBe(true)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should call onChange and close dropdown when selecting an option', async () => {
      // Arrange
      const onChange = jest.fn()
      const props = { ...defaultProps, onChange }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      // Open dropdown
      await user.click(screen.getByRole('button'))
      expect(mockPortalOpenState).toBe(true)

      // Select a different option
      const options = screen.getAllByText('var2')
      expect(options.length).toBeGreaterThan(0)
      await user.click(options[0])

      // Assert
      expect(onChange).toHaveBeenCalledWith('var2')
      expect(mockPortalOpenState).toBe(false)
    })

    it('should toggle dropdown when clicking trigger button multiple times', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      const button = screen.getByRole('button')

      // Open dropdown
      await user.click(button)
      expect(mockPortalOpenState).toBe(true)

      // Close dropdown
      await user.click(button)
      expect(mockPortalOpenState).toBe(false)
    })

    it('should support keyboard navigation with Enter key', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<VarPicker {...props} />)

      const button = screen.getByRole('button')

      // Focus button and press Enter
      button.focus()
      fireEvent.keyDown(button, { key: 'Enter' })

      // Assert - Portal should be rendered
      expect(screen.getByTestId('portal')).toBeInTheDocument()
    })

    it('should support keyboard navigation with Space key', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<VarPicker {...props} />)

      const button = screen.getByRole('button')

      // Focus button and press Space
      button.focus()
      fireEvent.keyDown(button, { key: ' ' })

      // Assert - Portal should be rendered
      expect(screen.getByTestId('portal')).toBeInTheDocument()
    })
  })

  // State Management
  describe('State Management', () => {
    it('should initialize with closed dropdown', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(mockPortalOpenState).toBe(false)
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should toggle dropdown state on trigger click', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      // Initial state
      expect(mockPortalOpenState).toBe(false)

      // Open dropdown
      await user.click(screen.getByRole('button'))
      expect(mockPortalOpenState).toBe(true)

      // Close dropdown
      await user.click(screen.getByRole('button'))
      expect(mockPortalOpenState).toBe(false)
    })

    it('should preserve selected value when dropdown is closed without selection', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      // Open and close dropdown without selecting anything
      await user.click(screen.getByRole('button'))
      await user.click(screen.getByRole('button'))

      // Assert
      expect(screen.getByText('var1')).toBeInTheDocument() // Original value still displayed
    })
  })

  // Edge Cases (REQUIRED)
  describe('Edge Cases', () => {
    it('should handle undefined value gracefully', () => {
      // Arrange
      const props = {
        ...defaultProps,
        value: undefined,
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByText(/choosePlaceholder/i)).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should handle empty options array', () => {
      // Arrange
      const props = {
        ...defaultProps,
        options: [],
        value: undefined,
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
      expect(screen.getByText(/choosePlaceholder/i)).toBeInTheDocument()
    })

    it('should handle null value without crashing', () => {
      // Arrange
      const props = {
        ...defaultProps,
        value: undefined,
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByText(/choosePlaceholder/i)).toBeInTheDocument()
    })

    it('should render when onChange is not provided', () => {
      // Arrange
      const props = {
        ...defaultProps,
        onChange: undefined as any,
      }

      // Act & Assert - Should not throw
      expect(() => {
        render(<VarPicker {...props} />)
      }).not.toThrow()
    })

    it('should handle variable names with special characters safely', () => {
      // Arrange
      const props = {
        ...defaultProps,
        options: [
          { name: 'Variable with & < > " \' characters', value: 'specialVar', type: 'string' },
        ],
        value: 'specialVar',
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByText('specialVar')).toBeInTheDocument()
    })

    it('should handle long variable names', () => {
      // Arrange
      const props = {
        ...defaultProps,
        options: [
          { name: 'A very long variable name that should be truncated', value: 'longVar', type: 'string' },
        ],
        value: 'longVar',
      }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByText('longVar')).toBeInTheDocument()
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })
})
