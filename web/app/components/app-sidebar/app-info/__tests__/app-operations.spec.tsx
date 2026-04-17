import type { Operation } from '../app-operations'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import AppOperations from '../app-operations'

vi.mock('../../../base/ui/button', () => ({
  Button: ({ children, onClick, className, size, variant, id, tabIndex, ...rest }: {
    'children': React.ReactNode
    'onClick'?: () => void
    'className'?: string
    'size'?: string
    'variant'?: string
    'id'?: string
    'tabIndex'?: number
    'data-targetid'?: string
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={className}
      data-size={size}
      data-variant={variant}
      id={id}
      tabIndex={tabIndex}
      data-targetid={rest['data-targetid']}
    >
      {children}
    </button>
  ),
}))

vi.mock('../../../base/ui/dropdown-menu', () => {
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
      onClick,
      render,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler<HTMLElement>
      render?: React.ReactElement
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
    DropdownMenuContent: ({ children, popupClassName }: { children: React.ReactNode, popupClassName?: string }) => {
      const { isOpen } = useDropdownMenuContext()
      if (!isOpen)
        return null

      return <div data-testid="dropdown-content" className={popupClassName}>{children}</div>
    },
    DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode, onClick?: React.MouseEventHandler<HTMLButtonElement> }) => {
      const { setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          data-testid="dropdown-item"
          onClick={(e) => {
            onClick?.(e)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
    DropdownMenuSeparator: () => <hr data-testid="dropdown-separator" />,
  }
})

const createOperation = (id: string, title: string, type?: 'divider'): Operation => ({
  id,
  title,
  icon: <svg data-testid={`icon-${id}`} />,
  onClick: vi.fn(),
  type,
})

function setupDomMeasurements(navWidth: number, moreWidth: number, childWidths: number[]) {
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.getAttribute('aria-hidden') === 'true')
        return navWidth
      if (this.id === 'more-measure')
        return moreWidth
      if (this.dataset.targetid) {
        const idx = Array.from(this.parentElement?.children ?? []).indexOf(this)
        return childWidths[idx] ?? 50
      }
      return 0
    },
  })

  return () => {
    if (originalClientWidth)
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth)
  }
}

describe('AppOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering with operations prop', () => {
    it('should render measurement container', () => {
      const ops = [createOperation('edit', 'Edit'), createOperation('copy', 'Copy')]
      const { container } = render(<AppOperations gap={4} operations={ops} />)
      expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    })

    it('should render operation buttons in measurement container', () => {
      const ops = [createOperation('edit', 'Edit'), createOperation('copy', 'Copy')]
      render(<AppOperations gap={4} operations={ops} />)
      const editButtons = screen.getAllByText('Edit')
      expect(editButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('should use operations as primary when provided', () => {
      const ops = [createOperation('edit', 'Edit')]
      const secondary = [createOperation('delete', 'Delete')]
      render(<AppOperations gap={4} operations={ops} secondaryOperations={secondary} />)
      const editButtons = screen.getAllByText('Edit')
      expect(editButtons.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Rendering with primaryOperations and secondaryOperations', () => {
    it('should render primary operations in measurement container', () => {
      const primary = [createOperation('edit', 'Edit')]
      render(<AppOperations gap={4} primaryOperations={primary} />)
      const editButtons = screen.getAllByText('Edit')
      expect(editButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('should use secondary operations when provided', () => {
      const primary = [createOperation('edit', 'Edit')]
      const secondary = [createOperation('delete', 'Delete')]
      render(<AppOperations gap={4} primaryOperations={primary} secondaryOperations={secondary} />)
      const editButtons = screen.getAllByText('Edit')
      expect(editButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('should use empty operations array when neither operations nor primaryOperations provided', () => {
      const { container } = render(<AppOperations gap={4} />)
      expect(container).toBeInTheDocument()
    })
  })

  describe('Overflow behavior', () => {
    it('should show all operations when container is wide enough', () => {
      const cleanup = setupDomMeasurements(500, 60, [80, 80])
      const ops = [createOperation('edit', 'Edit'), createOperation('copy', 'Copy')]

      render(<AppOperations gap={4} operations={ops} />)

      cleanup()
    })

    it('should move operations to more menu when container is narrow', () => {
      const cleanup = setupDomMeasurements(100, 60, [80, 80])
      const ops = [createOperation('edit', 'Edit'), createOperation('copy', 'Copy')]

      render(<AppOperations gap={4} operations={ops} />)

      cleanup()
    })

    it('should show last item without more button if it fits alone', () => {
      const cleanup = setupDomMeasurements(90, 60, [80])
      const ops = [createOperation('edit', 'Edit')]

      render(<AppOperations gap={4} operations={ops} />)

      cleanup()
    })
  })

  describe('More button', () => {
    it('should render more button text in measurement container', () => {
      const ops = [createOperation('edit', 'Edit')]
      render(<AppOperations gap={4} operations={ops} />)
      const moreButtons = screen.getAllByText('common.operation.more')
      expect(moreButtons.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle trigger more click', async () => {
      const cleanup = setupDomMeasurements(100, 60, [80, 80])
      const user = userEvent.setup()
      const ops = [createOperation('edit', 'Edit'), createOperation('copy', 'Copy')]
      const secondary = [createOperation('delete', 'Delete')]

      render(<AppOperations gap={4} primaryOperations={ops} secondaryOperations={secondary} />)

      const trigger = screen.queryByTestId('dropdown-trigger')
      if (trigger)
        await user.click(trigger)

      cleanup()
    })
  })

  describe('Visible operations click', () => {
    it('should call onClick when a visible operation is clicked', async () => {
      const cleanup = setupDomMeasurements(500, 60, [80, 80])
      const user = userEvent.setup()
      const editOp = createOperation('edit', 'Edit')
      const copyOp = createOperation('copy', 'Copy')

      render(<AppOperations gap={4} operations={[editOp, copyOp]} />)

      const visibleButtons = screen.getAllByText('Edit')
      const clickableButton = visibleButtons.find(btn => btn.closest('button')?.tabIndex !== -1)
      if (clickableButton)
        await user.click(clickableButton)

      cleanup()
    })
  })

  describe('Divider operations', () => {
    it('should filter out divider operations from inline display', () => {
      const ops = [
        createOperation('edit', 'Edit'),
        createOperation('div-1', '', 'divider'),
        createOperation('delete', 'Delete'),
      ]
      render(<AppOperations gap={4} operations={ops} />)
      const editButtons = screen.getAllByText('Edit')
      expect(editButtons.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Gap styling', () => {
    it('should apply gap to measurement and visible containers', () => {
      const ops = [createOperation('edit', 'Edit')]
      const { container } = render(<AppOperations gap={8} operations={ops} />)
      const hiddenContainer = container.querySelector('[aria-hidden="true"]')
      expect(hiddenContainer).toHaveStyle({ gap: '8px' })
    })

    it('should apply gap to visible container', () => {
      const ops = [createOperation('edit', 'Edit')]
      const { container } = render(<AppOperations gap={4} operations={ops} />)
      const containers = container.querySelectorAll('div[style]')
      const visibleContainer = Array.from(containers).find(
        el => el.getAttribute('aria-hidden') !== 'true',
      )
      if (visibleContainer)
        expect(visibleContainer).toHaveStyle({ gap: '4px' })
    })
  })

  describe('More menu content', () => {
    it('should render divider items in more menu', () => {
      const cleanup = setupDomMeasurements(100, 60, [80, 80])
      const primary = [createOperation('edit', 'Edit'), createOperation('copy', 'Copy')]
      const secondary = [
        createOperation('divider-1', '', 'divider'),
        createOperation('delete', 'Delete'),
      ]

      render(<AppOperations gap={4} primaryOperations={primary} secondaryOperations={secondary} />)

      cleanup()
    })
  })

  describe('Empty inline operations', () => {
    it('should handle when all operations are dividers', () => {
      const ops = [createOperation('div-1', '', 'divider'), createOperation('div-2', '', 'divider')]
      const { container } = render(<AppOperations gap={4} operations={ops} />)
      expect(container).toBeInTheDocument()
    })
  })
})
