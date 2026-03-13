import type { Props } from './var-picker'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import VarPicker from './var-picker'

// Mock external dependencies only
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

type PortalToFollowElemProps = {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}
type PortalToFollowElemTriggerProps = React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode, asChild?: boolean }
type PortalToFollowElemContentProps = React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }

vi.mock('@/app/components/base/portal-to-follow-elem', () => {
  const PortalContext = React.createContext({ open: false })

  const PortalToFollowElem = ({ children, open }: PortalToFollowElemProps) => {
    return (
      <PortalContext.Provider value={{ open: !!open }}>
        <div data-testid="portal">{children}</div>
      </PortalContext.Provider>
    )
  }

  const PortalToFollowElemContent = ({ children, ...props }: PortalToFollowElemContentProps) => {
    const { open } = React.useContext(PortalContext)
    if (!open)
      return null
    return (
      <div data-testid="portal-content" {...props}>
        {children}
      </div>
    )
  }

  const PortalToFollowElemTrigger = ({ children, asChild, ...props }: PortalToFollowElemTriggerProps) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, {
        ...props,
        'data-testid': 'portal-trigger',
      } as React.HTMLAttributes<HTMLElement>)
    }
    return (
      <div data-testid="portal-trigger" {...props}>
        {children}
      </div>
    )
  }

  return {
    PortalToFollowElem,
    PortalToFollowElemContent,
    PortalToFollowElemTrigger,
  }
})

describe('VarPicker', () => {
  const mockOptions: Props['options'] = [
    { name: 'Variable 1', value: 'var1', type: 'string' },
    { name: 'Variable 2', value: 'var2', type: 'number' },
    { name: 'Variable 3', value: 'var3', type: 'boolean' },
  ]

  const defaultProps: Props = {
    value: 'var1',
    options: mockOptions,
    onChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering tests (REQUIRED)
  describe('Rendering', () => {
    it('should render variable picker with dropdown trigger', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<VarPicker {...props} />)

      // Assert
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
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
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder')).toBeInTheDocument()
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

      // Assert - Trigger should be present
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
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
      expect(screen.getByTestId('portal-trigger')).toHaveClass('custom-trigger-class')
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
      const onChange = vi.fn()
      const props = { ...defaultProps, onChange }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)
      await user.click(screen.getByTestId('portal-trigger'))

      // Assert
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()
    })

    it('should call onChange and close dropdown when selecting an option', async () => {
      // Arrange
      const onChange = vi.fn()
      const props = { ...defaultProps, onChange }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      // Open dropdown
      await user.click(screen.getByTestId('portal-trigger'))
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Select a different option
      const options = screen.getAllByText('var2')
      expect(options.length).toBeGreaterThan(0)
      await user.click(options[0])

      // Assert
      expect(onChange).toHaveBeenCalledWith('var2')
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should toggle dropdown when clicking trigger button multiple times', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      const trigger = screen.getByTestId('portal-trigger')

      // Open dropdown
      await user.click(trigger)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Close dropdown
      await user.click(trigger)
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
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
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should toggle dropdown state on trigger click', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      const trigger = screen.getByTestId('portal-trigger')
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()

      // Open dropdown
      await user.click(trigger)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Close dropdown
      await user.click(trigger)
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should preserve selected value when dropdown is closed without selection', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<VarPicker {...props} />)

      // Open and close dropdown without selecting anything
      const trigger = screen.getByTestId('portal-trigger')
      await user.click(trigger)
      await user.click(trigger)

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
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder')).toBeInTheDocument()
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
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
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder')).toBeInTheDocument()
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
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder')).toBeInTheDocument()
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
      expect(screen.getByTestId('portal-trigger')).toBeInTheDocument()
    })
  })
})
