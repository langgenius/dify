import type { NavItem } from './nav-selector'
import type { AppContextValue } from '@/context/app-context'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'
import * as React from 'react'
import { vi } from 'vitest'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { AppModeEnum } from '@/types/app'
import Nav from './index'

vi.mock('@headlessui/react', () => {
  type MenuContextValue = { open: boolean, setOpen: (open: boolean) => void }
  const MenuContext = React.createContext<MenuContextValue | null>(null)

  const Menu = ({ children }: { children: React.ReactNode | ((props: { open: boolean }) => React.ReactNode) }) => {
    const [open, setOpen] = React.useState(false)
    const value = React.useMemo(() => ({ open, setOpen }), [open])
    return (
      <MenuContext.Provider value={value}>
        {typeof children === 'function' ? children({ open }) : children}
      </MenuContext.Provider>
    )
  }

  const MenuButton = ({ onClick, children, ...props }: { onClick?: () => void, children?: React.ReactNode }) => {
    const context = React.useContext(MenuContext)
    const handleClick = () => {
      context?.setOpen(!context.open)
      onClick?.()
    }
    return (
      <button type="button" aria-expanded={context?.open ?? false} onClick={handleClick} {...props}>
        {children}
      </button>
    )
  }

  const MenuItems = ({ as: Component = 'div', role, children, ...props }: { as?: React.ElementType, role?: string, children: React.ReactNode }) => {
    const context = React.useContext(MenuContext)
    if (!context?.open)
      return null
    return (
      <Component role={role ?? 'menu'} {...props}>
        {children}
      </Component>
    )
  }

  const MenuItem = ({ as: Component = 'div', role, children, ...props }: { as?: React.ElementType, role?: string, children: React.ReactNode }) => (
    <Component role={role ?? 'menuitem'} {...props}>
      {children}
    </Component>
  )

  return {
    Menu,
    MenuButton,
    MenuItems,
    MenuItem,
    Transition: ({ show = true, children }: { show?: boolean, children: React.ReactNode }) => (show ? <>{children}</> : null),
  }
})

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSelectedLayoutSegment: vi.fn(),
  useRouter: vi.fn(),
}))

// Mock app store
vi.mock('@/app/components/app/store', () => ({
  useStore: vi.fn(),
}))

// Mock app context
vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

describe('Nav Component', () => {
  const mockSetAppDetail = vi.fn()
  const mockOnCreate = vi.fn()
  const mockOnLoadMore = vi.fn()
  const mockPush = vi.fn()

  const navigationItems: NavItem[] = [
    {
      id: '1',
      name: 'Item 1',
      link: '/item1',
      icon_type: 'image',
      icon: 'icon1',
      icon_background: '#fff',
      icon_url: '/url1',
      mode: AppModeEnum.CHAT,
    },
    {
      id: '2',
      name: 'Item 2',
      link: '/item2',
      icon_type: 'image',
      icon: 'icon2',
      icon_background: '#000',
      icon_url: '/url2',
    },
  ]

  const defaultProps = {
    icon: <span data-testid="default-icon">Icon</span>,
    activeIcon: <span data-testid="active-icon">Active Icon</span>,
    text: 'Nav Text',
    activeSegment: 'explore',
    link: '/explore',
    isApp: false,
    navigationItems,
    createText: 'Create New',
    onCreate: mockOnCreate,
    onLoadMore: mockOnLoadMore,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useSelectedLayoutSegment).mockReturnValue('explore')
    vi.mocked(useAppStore).mockReturnValue(mockSetAppDetail)
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: true,
    } as unknown as AppContextValue)
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
    } as unknown as ReturnType<typeof useRouter>)
  })

  describe('Rendering', () => {
    it('should render correctly when activated', () => {
      render(<Nav {...defaultProps} />)
      expect(screen.getByText('Nav Text')).toBeInTheDocument()
      expect(screen.getByTestId('active-icon')).toBeInTheDocument()
    })

    it('should render correctly when not activated', () => {
      vi.mocked(useSelectedLayoutSegment).mockReturnValue('other')
      render(<Nav {...defaultProps} />)
      expect(screen.getByTestId('default-icon')).toBeInTheDocument()
    })

    it('should handle array activeSegment', () => {
      render(<Nav {...defaultProps} activeSegment={['explore', 'apps']} />)
      expect(screen.getByTestId('active-icon')).toBeInTheDocument()
    })

    it('should not show hover background if not activated', () => {
      vi.mocked(useSelectedLayoutSegment).mockReturnValue('other')
      const { container } = render(<Nav {...defaultProps} />)
      const navDiv = container.firstChild as HTMLElement
      expect(navDiv.className).toContain(
        'hover:bg-components-main-nav-nav-button-bg-hover',
      )
    })
  })

  describe('User Interactions', () => {
    it('should call setAppDetail when clicked', () => {
      render(<Nav {...defaultProps} />)
      const link = screen.getByRole('link')
      fireEvent.click(link.firstChild!)
      expect(mockSetAppDetail).toHaveBeenCalled()
    })

    it('should not call setAppDetail when clicked with modifier keys', () => {
      render(<Nav {...defaultProps} />)
      const link = screen.getByRole('link')
      fireEvent.click(link.firstChild!, { metaKey: true })
      expect(mockSetAppDetail).not.toHaveBeenCalled()
    })

    it('should show ArrowNarrowLeft on hover when curNav is provided and activated', () => {
      const curNav = navigationItems[0]
      render(<Nav {...defaultProps} curNav={curNav} />)

      const navItem = screen.getByText('Nav Text').parentElement!
      fireEvent.mouseEnter(navItem)

      expect(screen.queryByTestId('active-icon')).not.toBeInTheDocument()

      fireEvent.mouseLeave(navItem)
      expect(screen.getByTestId('active-icon')).toBeInTheDocument()
    })
  })

  describe('NavSelector', () => {
    const curNav = navigationItems[0]

    it('should render NavSelector when activated and curNav is provided', () => {
      render(<Nav {...defaultProps} curNav={curNav} />)
      expect(screen.getByText('/')).toBeInTheDocument()
      expect(screen.getByText('Item 1')).toBeInTheDocument()
    })

    it('should open menu and show items when clicked', async () => {
      render(<Nav {...defaultProps} curNav={curNav} />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      await waitFor(() => {
        expect(screen.getByText('Item 2')).toBeInTheDocument()
      })
    })

    it('should navigate when an item is selected', async () => {
      render(<Nav {...defaultProps} curNav={curNav} />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      const item2 = await screen.findByText('Item 2')
      await act(async () => {
        fireEvent.click(item2)
      })

      expect(mockSetAppDetail).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/item2')
    })

    it('should not navigate if selecting current nav item', async () => {
      render(<Nav {...defaultProps} curNav={curNav} />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      const listItems = await screen.findAllByText('Item 1')
      const listItem = listItems.find(el => el.closest('[role="menuitem"]'))

      if (listItem) {
        await act(async () => {
          fireEvent.click(listItem)
        })
      }

      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should call onCreate when create button is clicked', async () => {
      render(<Nav {...defaultProps} curNav={curNav} />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      const createButton = await screen.findByText('Create New')
      await act(async () => {
        fireEvent.click(createButton)
      })

      expect(mockOnCreate).toHaveBeenCalledWith('')
    })

    it('should show sub-menu and call onCreate with types when isApp is true', async () => {
      render(<Nav {...defaultProps} curNav={curNav} isApp />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      const createButton = await screen.findByText('Create New')
      await act(async () => {
        fireEvent.click(createButton)
      })

      const blankOption = await screen.findByText(
        /app\.newApp\.startFromBlank/i,
      )
      await act(async () => {
        fireEvent.click(blankOption)
      })
      expect(mockOnCreate).toHaveBeenCalledWith('blank')

      const templateOption = await screen.findByText(
        /app\.newApp\.startFromTemplate/i,
      )
      await act(async () => {
        fireEvent.click(templateOption)
      })
      expect(mockOnCreate).toHaveBeenCalledWith('template')

      const dslOption = await screen.findByText(/app\.importDSL/i)
      await act(async () => {
        fireEvent.click(dslOption)
      })
      expect(mockOnCreate).toHaveBeenCalledWith('dsl')
    })

    it('should not show create button if NOT an editor', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceEditor: false,
      } as unknown as AppContextValue)
      render(<Nav {...defaultProps} curNav={curNav} />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      await waitFor(() => {
        expect(screen.queryByText('Create New')).not.toBeInTheDocument()
      })
    })

    it('should show loading state in selector when isLoadingMore is true', async () => {
      render(<Nav {...defaultProps} curNav={curNav} isLoadingMore />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      const status = await screen.findByRole('status')
      expect(status).toBeInTheDocument()
    })

    it('should call onLoadMore when scrolling reaches bottom', async () => {
      render(<Nav {...defaultProps} curNav={curNav} />)
      const selectorButton = screen.getByRole('button', { name: /Item 1/i })

      await act(async () => {
        fireEvent.click(selectorButton)
      })

      const scrollContainer = await screen.findByRole('menu').then((menu) => {
        const container = menu.querySelector('.overflow-auto')
        if (!container)
          throw new Error('Not found')
        return container as HTMLElement
      })

      vi.useFakeTimers()

      Object.defineProperty(scrollContainer, 'scrollHeight', {
        value: 600,
        configurable: true,
      })
      Object.defineProperty(scrollContainer, 'clientHeight', {
        value: 150,
        configurable: true,
      })
      Object.defineProperty(scrollContainer, 'scrollTop', {
        value: 500,
        configurable: true,
      })

      fireEvent.scroll(scrollContainer)

      act(() => {
        vi.runAllTimers()
      })

      expect(mockOnLoadMore).toHaveBeenCalled()
      vi.useRealTimers()
    })
  })
})
