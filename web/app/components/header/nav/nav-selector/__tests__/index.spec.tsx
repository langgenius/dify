import type { INavSelectorProps, NavItem } from '../index'
import type { AppContextValue } from '@/context/app-context'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { useRouter } from '@/next/navigation'
import { AppModeEnum } from '@/types/app'
import NavSelector from '../index'

// Mock next/navigation
vi.mock('@/next/navigation', () => ({
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

describe('NavSelector Component', () => {
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

  const { link: _link, ...curNavWithoutLink } = navigationItems[0]!

  const defaultProps: INavSelectorProps = {
    curNav: curNavWithoutLink,
    navigationItems,
    createText: 'Create New',
    onCreate: mockOnCreate,
    onLoadMore: mockOnLoadMore,
    isApp: false,
    isLoadingMore: false,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAppStore).mockReturnValue(mockSetAppDetail)
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceEditor: true,
    } as unknown as AppContextValue)
    vi.mocked(useRouter).mockReturnValue({
      push: mockPush,
    } as unknown as ReturnType<typeof useRouter>)
  })

  describe('Rendering', () => {
    it('should render current nav name', () => {
      render(<NavSelector {...defaultProps} />)
      expect(screen.getByText('Item 1'))!.toBeInTheDocument()
    })

    it('should show loading indicator when isLoadingMore is true', async () => {
      render(<NavSelector {...defaultProps} isLoadingMore />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })
      expect(screen.getByRole('status'))!.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should open menu and show items', async () => {
      render(<NavSelector {...defaultProps} />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })
      expect(screen.getByText('Item 2'))!.toBeInTheDocument()
    })

    it('should navigate and call setAppDetail when an item is clicked', async () => {
      render(<NavSelector {...defaultProps} />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })
      const item2 = screen.getByText('Item 2')
      await act(async () => {
        fireEvent.click(item2)
      })
      expect(mockSetAppDetail).toHaveBeenCalled()
      expect(mockPush).toHaveBeenCalledWith('/item2')
    })

    it('should not navigate if current item is clicked', async () => {
      render(<NavSelector {...defaultProps} />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })
      const items = screen.getAllByText('Item 1')
      const listItem = items.find(el => el.closest('[role="menuitem"]'))
      if (listItem) {
        await act(async () => {
          fireEvent.click(listItem)
        })
      }
      expect(mockPush).not.toHaveBeenCalled()
    })

    it('should call onCreate when create button is clicked (non-app mode)', async () => {
      render(<NavSelector {...defaultProps} />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })
      const createBtn = screen.getByText('Create New')
      await act(async () => {
        fireEvent.click(createBtn)
      })
      expect(mockOnCreate).toHaveBeenCalledWith('')
    })

    it('should show extended create menu in app mode', async () => {
      const user = userEvent.setup()
      render(<NavSelector {...defaultProps} isApp />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })

      const openCreateMenu = async () => {
        if (!screen.queryByRole('menuitem', { name: /Create New/i }))
          await user.click(screen.getByRole('button', { name: /Item 1/i }))
        const createBtn = await screen.findByRole('menuitem', { name: /Create New/i })
        await user.hover(createBtn)
        return screen.findByText(/app\.newApp\.startFromBlank/i)
      }

      await openCreateMenu()
      const blank = await screen.findByText(/app\.newApp\.startFromBlank/i)
      await act(async () => {
        fireEvent.click(blank)
      })
      expect(mockOnCreate).toHaveBeenCalledWith('blank')

      await openCreateMenu()
      const template = await screen.findByText(/app\.newApp\.startFromTemplate/i)
      await act(async () => {
        fireEvent.click(template)
      })
      expect(mockOnCreate).toHaveBeenCalledWith('template')

      await openCreateMenu()
      const dsl = await screen.findByText(/app\.importDSL/i)
      await act(async () => {
        fireEvent.click(dsl)
      })
      expect(mockOnCreate).toHaveBeenCalledWith('dsl')
    })

    it('should open extended create menu on hover in app mode', async () => {
      const user = userEvent.setup()
      render(<NavSelector {...defaultProps} isApp />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })

      const createBtn = await screen.findByRole('menuitem', { name: /Create New/i })
      await user.hover(createBtn)

      expect(await screen.findByText(/app\.newApp\.startFromBlank/i))!.toBeInTheDocument()
    })

    it('should not show create button for non-editors', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceEditor: false,
      } as unknown as AppContextValue)
      render(<NavSelector {...defaultProps} />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })
      expect(screen.queryByText('Create New')).not.toBeInTheDocument()
    })
  })

  describe('Scroll behavior', () => {
    it('should call onLoadMore when scrolled to bottom', async () => {
      render(<NavSelector {...defaultProps} />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })

      const menu = screen.getByRole('menu')
      const scrollable = menu.querySelector('.overflow-auto') as HTMLElement

      vi.useFakeTimers()

      // Trigger scroll
      Object.defineProperty(scrollable, 'scrollHeight', {
        value: 600,
        configurable: true,
      })
      Object.defineProperty(scrollable, 'clientHeight', {
        value: 150,
        configurable: true,
      })
      Object.defineProperty(scrollable, 'scrollTop', {
        value: 500,
        configurable: true,
      })

      fireEvent.scroll(scrollable)

      act(() => {
        vi.runAllTimers()
      })

      expect(mockOnLoadMore).toHaveBeenCalled()

      // Check that it's NOT called if not at bottom
      mockOnLoadMore.mockClear()
      Object.defineProperty(scrollable, 'scrollTop', {
        value: 100,
        configurable: true,
      })
      fireEvent.scroll(scrollable)
      act(() => {
        vi.runAllTimers()
      })
      expect(mockOnLoadMore).not.toHaveBeenCalled()

      vi.useRealTimers()
    })

    it('should not throw if onLoadMore is undefined', async () => {
      const { onLoadMore: _o, ...propsWithoutOnLoadMore } = defaultProps
      render(<NavSelector {...propsWithoutOnLoadMore} />)
      const button = screen.getByRole('button')
      await act(async () => {
        fireEvent.click(button)
      })

      const menu = screen.getByRole('menu')
      const scrollable = menu.querySelector('.overflow-auto') as HTMLElement

      fireEvent.scroll(scrollable)
      // No error should be thrown
    })
  })
})
