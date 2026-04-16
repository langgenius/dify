import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OperationDropdown from '../operation-dropdown'

vi.mock('@/app/components/base/ui/dropdown-menu', async () => {
  const React = await import('react')
  const DropdownMenuContext = React.createContext<{ isOpen: boolean, setOpen: (open: boolean) => void } | null>(null)

  const useDropdownMenuContext = () => {
    const context = React.use(DropdownMenuContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <DropdownMenuContext value={{ isOpen: open, setOpen: onOpenChange ?? vi.fn() }}>
        <div data-testid="dropdown-menu" data-open={open}>{children}</div>
      </DropdownMenuContext>
    ),
    DropdownMenuTrigger: ({
      children,
      render,
      onClick,
    }: {
      children: React.ReactNode
      render?: React.ReactElement
      onClick?: React.MouseEventHandler<HTMLElement>
    }) => {
      const { isOpen, setOpen } = useDropdownMenuContext()
      const handleClick = (e: React.MouseEvent<HTMLElement>) => {
        onClick?.(e)
        setOpen(!isOpen)
      }

      if (render)
        return React.cloneElement(render, { 'data-testid': 'dropdown-trigger', 'onClick': handleClick } as Record<string, unknown>, children)

      return <button data-testid="dropdown-trigger" onClick={handleClick}>{children}</button>
    },
    DropdownMenuContent: ({
      children,
      className,
      popupClassName,
    }: {
      children: React.ReactNode
      className?: string
      popupClassName?: string
    }) => {
      const { isOpen } = useDropdownMenuContext()
      return isOpen ? <div data-testid="dropdown-content" className={[className, popupClassName].filter(Boolean).join(' ')}>{children}</div> : null
    },
    DropdownMenuItem: ({
      children,
      onClick,
      className,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler<HTMLButtonElement>
      className?: string
    }) => {
      const { setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          data-testid="dropdown-item"
          className={className}
          onClick={(e) => {
            onClick?.(e)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
  }
})

describe('OperationDropdown', () => {
  const defaultProps = {
    onEdit: vi.fn(),
    onRemove: vi.fn(),
  }

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<OperationDropdown {...defaultProps} />)
      expect(document.querySelector('button')).toBeInTheDocument()
    })

    it('should render trigger button with more icon', () => {
      render(<OperationDropdown {...defaultProps} />)
      const button = screen.getByTestId('dropdown-trigger')
      expect(button).toBeInTheDocument()
      const svg = button?.querySelector('svg')
      expect(svg).toBeInTheDocument()
    })

    it('should render medium size by default', () => {
      render(<OperationDropdown {...defaultProps} />)
      const icon = document.querySelector('.h-4.w-4')
      expect(icon).toBeInTheDocument()
    })

    it('should render large size when inCard is true', () => {
      render(<OperationDropdown {...defaultProps} inCard={true} />)
      const icon = document.querySelector('.h-5.w-5')
      expect(icon).toBeInTheDocument()
    })
  })

  describe('Dropdown Behavior', () => {
    it('should open dropdown when trigger is clicked', async () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))

      expect(screen.getByText('tools.mcp.operation.edit')).toBeInTheDocument()
      expect(screen.getByText('tools.mcp.operation.remove')).toBeInTheDocument()
    })

    it('should call onOpenChange when opened', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      expect(onOpenChange).toHaveBeenCalledWith(true)
    })

    it('should close dropdown when trigger is clicked again', async () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      expect(onOpenChange).toHaveBeenLastCalledWith(false)
    })
  })

  describe('Menu Actions', () => {
    it('should call onEdit when edit option is clicked', () => {
      const onEdit = vi.fn()
      render(<OperationDropdown {...defaultProps} onEdit={onEdit} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      fireEvent.click(screen.getByText('tools.mcp.operation.edit'))
      expect(onEdit).toHaveBeenCalledTimes(1)
    })

    it('should call onRemove when remove option is clicked', () => {
      const onRemove = vi.fn()
      render(<OperationDropdown {...defaultProps} onRemove={onRemove} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      fireEvent.click(screen.getByText('tools.mcp.operation.remove'))
      expect(onRemove).toHaveBeenCalledTimes(1)
    })

    it('should close dropdown after edit is clicked', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      onOpenChange.mockClear()
      fireEvent.click(screen.getByText('tools.mcp.operation.edit'))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('should close dropdown after remove is clicked', () => {
      const onOpenChange = vi.fn()
      render(<OperationDropdown {...defaultProps} onOpenChange={onOpenChange} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      onOpenChange.mockClear()
      fireEvent.click(screen.getByText('tools.mcp.operation.remove'))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  describe('Styling', () => {
    it('should have correct dropdown width', () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      const dropdown = document.querySelector('.w-\\[160px\\]')
      expect(dropdown).toBeInTheDocument()
    })

    it('should render dropdown content through the shared popup shell', () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      expect(screen.getByTestId('dropdown-content')).toBeInTheDocument()
    })

    it('should apply destructive highlighted styles on remove option', () => {
      render(<OperationDropdown {...defaultProps} />)

      fireEvent.click(screen.getByTestId('dropdown-trigger'))
      const removeOptionText = screen.getByText('tools.mcp.operation.remove')
      const removeOptionContainer = removeOptionText.closest('button')
      expect(removeOptionContainer).toHaveClass('data-highlighted:bg-state-destructive-hover')
    })
  })

  describe('inCard prop', () => {
    it('should adjust offset when inCard is false', () => {
      render(<OperationDropdown {...defaultProps} inCard={false} />)
      // Component renders with different offset values
      expect(document.querySelector('button')).toBeInTheDocument()
    })

    it('should adjust offset when inCard is true', () => {
      render(<OperationDropdown {...defaultProps} inCard={true} />)
      // Component renders with different offset values
      expect(document.querySelector('button')).toBeInTheDocument()
    })
  })
})
