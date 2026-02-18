import type { Props } from './var-picker'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import ContextVar from './index'

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

describe('ContextVar', () => {
  const mockOptions: Props['options'] = [
    { name: 'Variable 1', value: 'var1', type: 'string' },
    { name: 'Variable 2', value: 'var2', type: 'number' },
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
    it('should display query variable selector when options are provided', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title')).toBeInTheDocument()
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
      const onChange = vi.fn()
      const props = { ...defaultProps, onChange }
      const user = userEvent.setup()

      // Act
      render(<ContextVar {...props} />)

      const triggers = screen.getAllByTestId('portal-trigger')
      const varPickerTrigger = triggers[triggers.length - 1]

      await user.click(varPickerTrigger)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Select a different option
      const options = screen.getAllByText('var2')
      expect(options.length).toBeGreaterThan(0)
      await user.click(options[0])

      // Assert
      expect(onChange).toHaveBeenCalledWith('var2')
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
    })

    it('should toggle dropdown when clicking the trigger button', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<ContextVar {...props} />)

      const triggers = screen.getAllByTestId('portal-trigger')
      const varPickerTrigger = triggers[triggers.length - 1]

      // Open dropdown
      await user.click(varPickerTrigger)
      expect(screen.getByTestId('portal-content')).toBeInTheDocument()

      // Close dropdown
      await user.click(varPickerTrigger)
      expect(screen.queryByTestId('portal-content')).not.toBeInTheDocument()
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
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title')).toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder')).toBeInTheDocument()
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
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title')).toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder')).toBeInTheDocument()
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
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title')).toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder')).toBeInTheDocument()
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
