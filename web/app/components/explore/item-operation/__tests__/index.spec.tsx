import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import ItemOperation from '../index'

vi.mock('@langgenius/dify-ui/dropdown-menu', () => {
  const DropdownMenuContext = React.createContext<{ isOpen: boolean, setOpen: (open: boolean) => void } | null>(null)

  const useDropdownMenuContext = () => {
    const context = React.use(DropdownMenuContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({
      children,
      modal,
    }: {
      children: React.ReactNode
      modal?: boolean
    }) => {
      const [isOpen, setIsOpen] = React.useState(false)

      return (
        <DropdownMenuContext value={{ isOpen, setOpen: setIsOpen }}>
          <div data-modal={modal} data-open={isOpen} data-testid="dropdown-menu">{children}</div>
        </DropdownMenuContext>
      )
    },
    DropdownMenuTrigger: ({
      children,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const { isOpen, setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          onClick={(e) => {
            onClick?.(e)
            setOpen(!isOpen)
          }}
          {...props}
        >
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({
      children,
      popupProps,
    }: {
      children: React.ReactNode
      popupProps?: React.HTMLAttributes<HTMLDivElement>
    }) => {
      const { isOpen } = useDropdownMenuContext()
      if (!isOpen)
        return null

      return <div data-testid="dropdown-content" {...popupProps}>{children}</div>
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

describe('ItemOperation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderComponent = (overrides: Partial<React.ComponentProps<typeof ItemOperation>> = {}) => {
    const props: React.ComponentProps<typeof ItemOperation> = {
      isPinned: false,
      isShowDelete: true,
      togglePin: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    }
    return {
      props,
      ...render(<ItemOperation {...props} />),
    }
  }

  describe('Rendering', () => {
    it('should render pin and delete actions when menu is open', async () => {
      renderComponent()

      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      expect(await screen.findByText('explore.sidebar.action.pin')).toBeInTheDocument()
      expect(screen.getByText('explore.sidebar.action.delete')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should render rename action when isShowRenameConversation is true', async () => {
      renderComponent({ isShowRenameConversation: true })

      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      expect(await screen.findByText('explore.sidebar.action.rename')).toBeInTheDocument()
    })

    it('should render unpin label when isPinned is true', async () => {
      renderComponent({ isPinned: true })

      fireEvent.click(screen.getByTestId('item-operation-trigger'))

      expect(await screen.findByText('explore.sidebar.action.unpin')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call togglePin when clicking pin action', async () => {
      const { props } = renderComponent()

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

      expect(props.togglePin).toHaveBeenCalledTimes(1)
    })

    it('should call onDelete when clicking delete action', async () => {
      const { props } = renderComponent()

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.delete'))

      expect(props.onDelete).toHaveBeenCalledTimes(1)
    })

    it('should call onRenameConversation when clicking rename action', async () => {
      const onRenameConversation = vi.fn()
      renderComponent({
        isShowRenameConversation: true,
        onRenameConversation,
      })

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.rename'))

      expect(onRenameConversation).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should keep the menu open when item hover leaves', async () => {
      const { props, rerender } = renderComponent({ isItemHovering: true })
      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      await screen.findByText('explore.sidebar.action.pin')

      rerender(<ItemOperation {...props} isItemHovering={false} />)

      expect(screen.getByText('explore.sidebar.action.pin')).toBeInTheDocument()
    })

    it('should render a non-modal menu', () => {
      renderComponent()

      expect(screen.getByTestId('dropdown-menu')).toHaveAttribute('data-modal', 'false')
    })

    it('should stop propagation when clicking menu actions', async () => {
      const onParentClick = vi.fn()
      const togglePin = vi.fn()

      render(
        <div onClick={onParentClick}>
          <ItemOperation
            isPinned={false}
            isShowDelete
            togglePin={togglePin}
            onDelete={vi.fn()}
          />
        </div>,
      )

      fireEvent.click(screen.getByTestId('item-operation-trigger'))
      fireEvent.click(await screen.findByText('explore.sidebar.action.pin'))

      expect(togglePin).toHaveBeenCalledTimes(1)
      expect(onParentClick).not.toHaveBeenCalled()
    })
  })
})
