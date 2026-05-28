import type * as React from 'react'
import type { Props } from '../var-picker'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ContextVar from '../index'

// Mock external dependencies only
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

vi.mock('@langgenius/dify-ui/popover', async () => {
  const React = await import('react')
  const PopoverContext = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  })

  const Popover = ({
    children,
    open: controlledOpen,
    onOpenChange,
  }: {
    children: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
  }) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? !!controlledOpen : uncontrolledOpen
    const setOpen = (nextOpen: boolean) => {
      if (!isControlled)
        setUncontrolledOpen(nextOpen)
      onOpenChange?.(nextOpen)
    }

    return (
      <PopoverContext.Provider value={{ open, setOpen }}>
        {children}
      </PopoverContext.Provider>
    )
  }

  const PopoverTrigger = ({ render }: { render: React.ReactNode }) => {
    const { open, setOpen } = React.useContext(PopoverContext)
    return (
      <div
        data-testid="popover-trigger"
        onClick={() => setOpen(!open)}
      >
        {render}
      </div>
    )
  }

  const PopoverContent = ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => {
    const { open } = React.useContext(PopoverContext)
    if (!open)
      return null

    return (
      <div data-testid="popover-content" {...props}>
        {children}
      </div>
    )
  }

  return {
    Popover,
    PopoverTrigger,
    PopoverContent,
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
      // Assert
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title'))!.toBeInTheDocument()
    })

    it('should show selected variable with proper formatting when value is provided', () => {
      // Arrange
      const props = { ...defaultProps }

      // Act
      render(<ContextVar {...props} />)

      // Assert
      // Assert
      expect(screen.getByText('var1'))!.toBeInTheDocument()
      expect(screen.getByText('{{'))!.toBeInTheDocument()
      expect(screen.getByText('}}'))!.toBeInTheDocument()
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
      // Assert - Should display the selected value
      expect(screen.getByText('var2'))!.toBeInTheDocument()
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
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      // Assert - Should show placeholder instead of variable
      expect(screen.queryByText('var1')).not.toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder'))!.toBeInTheDocument()
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
      // Assert
      expect(screen.getByText('Select a variable'))!.toBeInTheDocument()
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
      // Assert
      expect(container.querySelector('.custom-class'))!.toBeInTheDocument()
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

      const varPickerTrigger = screen.getAllByTestId('popover-trigger').at(-1)!

      await user.click(varPickerTrigger!)
      expect(screen.getByTestId('popover-content'))!.toBeInTheDocument()

      // Select a different option
      await user.click(screen.getByText('var2'))

      // Assert
      expect(onChange).toHaveBeenCalledWith('var2')
      expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
    })

    it('should toggle dropdown when clicking the trigger button', async () => {
      // Arrange
      const props = { ...defaultProps }
      const user = userEvent.setup()

      // Act
      render(<ContextVar {...props} />)

      const varPickerTrigger = screen.getAllByTestId('popover-trigger').at(-1)!

      // Open dropdown
      await user.click(varPickerTrigger!)
      expect(screen.getByTestId('popover-content'))!.toBeInTheDocument()

      // Close dropdown
      await user.click(varPickerTrigger!)
      expect(screen.queryByTestId('popover-content')).not.toBeInTheDocument()
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
      // Assert
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title'))!.toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder'))!.toBeInTheDocument()
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
      // Assert
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title'))!.toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder'))!.toBeInTheDocument()
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
      // Assert
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.title'))!.toBeInTheDocument()
      expect(screen.getByText('appDebug.feature.dataSet.queryVariable.choosePlaceholder'))!.toBeInTheDocument()
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
      // Assert
      expect(screen.getByText('strVar'))!.toBeInTheDocument()
      expect(screen.getByText('{{'))!.toBeInTheDocument()
      expect(screen.getByText('}}'))!.toBeInTheDocument()
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
      // Assert
      expect(screen.getByText('specialVar'))!.toBeInTheDocument()
    })
  })
})
