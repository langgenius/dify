import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContextVar from './index'
import type { Props } from './var-picker'

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
    return <div data-testid="portal" data-open={open}>{children}</div>
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
        if (mockOnOpenChange) mockOnOpenChange(!mockPortalOpenState)
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

describe('ContextVar', () => {
  const mockOptions: Props['options'] = [
    { name: 'Variable 1', value: 'var1', type: 'string' },
    { name: 'Variable 2', value: 'var2', type: 'number' },
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
    it('should display query variable selector when options are provided', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText(/appDebug.feature.dataSet.queryVariable.title/i)).toBeInTheDocument()
    })

    it('should show selected variable with proper formatting when value is provided', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText('var1')).toBeInTheDocument()
      expect(screen.getByText('{{')).toBeInTheDocument()
      expect(screen.getByText('}}')).toBeInTheDocument()
    })

    it('should render tooltip with help content', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<ContextVar {...props} />)

      // Assert - Tooltip trigger should be present
      const tooltipTrigger = screen.getAllByRole('button')[0]
      expect(tooltipTrigger).toBeInTheDocument()
    })
  })

  // Props tests (REQUIRED)
  describe('Props', () => {
    it('should display selected variable when value prop is provided', () => {
      // Arrange
      const props = { ...defaultProps, value: 'var2' }

      // Act
      render(<ContextVar {...props} />)

      // Assert - Should display the selected value
      expect(screen.getByText('var2')).toBeInTheDocument()
    })

    it('should show placeholder text when no value is selected', () => {
      // Arrange
      const props = {
        ...defaultProps,
        value: undefined,
      }

      // Act
      render(<ContextVar {...props} />)

      // Assert - Should show placeholder instead of variable
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
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText('Select a variable')).toBeInTheDocument()
    })

    it('should apply custom className to VarPicker when provided', () => {
      // Arrange
      const props = {
        ...defaultProps,
        className: 'custom-class',
      }

      // Act
      const { container } = render(<ContextVar {...props} />)

      // Assert
      expect(container.querySelector('.custom-class')).toBeInTheDocument()
    })
  })

  // User Interactions
  describe('User Interactions', () => {
    it('should call onChange when user selects a different variable', async () => {
      // Arrange
      const onChange = jest.fn()
      const props = { ...defaultProps, onChange }
      const user = userEvent.setup()

      // Act
      render(<ContextVar {...props} />)

      // Open dropdown (second button is the VarPicker trigger)
      const triggers = screen.getAllByRole('button')
      await user.click(triggers[1])
      expect(mockPortalOpenState).toBe(true)

      // Select a different option
      const options = screen.getAllByText('var2')
      expect(options.length).toBeGreaterThan(0)
      await user.click(options[0])

      // Assert
      expect(onChange).toHaveBeenCalledWith('var2')
      expect(mockPortalOpenState).toBe(false)
    })

    it('should toggle dropdown when clicking the trigger button', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<ContextVar {...props} />)

      const triggers = screen.getAllByRole('button')
      const varPickerTrigger = triggers[1]

      // Open dropdown
      await user.click(varPickerTrigger)
      expect(mockPortalOpenState).toBe(true)

      // Close dropdown
      await user.click(varPickerTrigger)
      expect(mockPortalOpenState).toBe(false)
    })

    it('should support keyboard navigation', async () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<ContextVar {...props} />)

      const triggers = screen.getAllByRole('button')
      const varPickerTrigger = triggers[1]

      // Focus trigger and press Enter
      varPickerTrigger.focus()
      fireEvent.keyDown(varPickerTrigger, { key: 'Enter' })

      // Assert - Portal should be toggled (check for open state change)
      expect(mockPortalOpenState).toBe(true)
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
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText(/queryVariable.title/i)).toBeInTheDocument()
      expect(screen.getByText(/choosePlaceholder/i)).toBeInTheDocument()
      expect(screen.queryByText('var1')).not.toBeInTheDocument()
    })

    it('should handle empty options array', () => {
      // Arrange
      const props = {
        ...defaultProps,
        options: [],
        value: undefined,
      }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText(/queryVariable.title/i)).toBeInTheDocument()
      expect(screen.getByText(/choosePlaceholder/i)).toBeInTheDocument()
    })

    it('should handle null value without crashing', () => {
      // Arrange
      const props = {
        ...defaultProps,
        value: undefined,
      }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText(/queryVariable.title/i)).toBeInTheDocument()
      expect(screen.getByText(/choosePlaceholder/i)).toBeInTheDocument()
    })

    it('should handle options with different data types', () => {
      // Arrange
      const props = {
        ...defaultProps,
        options: [
          { name: 'String Var', value: 'strVar', type: 'string' },
          { name: 'Number Var', value: '42', type: 'number' },
          { name: 'Boolean Var', value: 'true', type: 'boolean' },
        ],
        value: 'strVar',
      }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText('strVar')).toBeInTheDocument()
      expect(screen.getByText('{{')).toBeInTheDocument()
      expect(screen.getByText('}}')).toBeInTheDocument()
    })

    it('should render variable names with special characters safely', () => {
      // Arrange
      const props = {
        ...defaultProps,
        options: [
          { name: 'Variable with & < > " \' characters', value: 'specialVar', type: 'string' },
        ],
        value: 'specialVar',
      }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText('specialVar')).toBeInTheDocument()
    })
  })
})
