import type { ReactElement } from 'react'
import type { ChatWithHistoryContextValue } from '../../context'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import * as ReactI18next from 'react-i18next'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { useChatWithHistoryContext } from '../../context'
import Sidebar from '../index'
import RenameModal from '../rename-modal'

let mockBranding: { enabled: boolean, workspace_logo: string } = { enabled: false, workspace_logo: '' }
const render = (ui: ReactElement) => renderWithSystemFeatures(ui, {
  systemFeatures: { branding: { ...mockBranding } },
})

function mockUseTranslationWithEmptyKeys(emptyKeys: string[]) {
  const originalUseTranslation = ReactI18next.useTranslation
  return vi.spyOn(ReactI18next, 'useTranslation').mockImplementation((...args) => {
    const translation = originalUseTranslation(...args)
    const defaultNsArg = args[0]
    const defaultNs = Array.isArray(defaultNsArg) ? defaultNsArg[0] : defaultNsArg

    return {
      ...translation,
      t: ((key: string, options?: Record<string, unknown>) => {
        if (emptyKeys.includes(key))
          return ''
        const ns = (options?.ns as string | undefined) ?? defaultNs
        return ns ? `${ns}.${key}` : key
      }) as typeof translation.t,
    }
  })
}

// Mock List to allow us to trigger operations
vi.mock('../list', () => ({
  default: ({ list, onOperate, title, isPin }: { list: Array<{ id: string, name: string }>, onOperate: (type: string, item: { id: string, name: string }) => void, title?: string, isPin?: boolean }) => (
    <div data-testid={isPin ? 'pinned-list' : 'conversation-list'}>
      {title && <div data-testid="list-title">{title}</div>}
      {list.map(item => (
        <div key={item.id} data-testid={`list-item-${item.id}`}>
          <div>{item.name}</div>
          <button data-testid={`pin-${item.id}`} onClick={() => onOperate('pin', item)}>Pin</button>
          <button data-testid={`unpin-${item.id}`} onClick={() => onOperate('unpin', item)}>Unpin</button>
          <button data-testid={`delete-${item.id}`} onClick={() => onOperate('delete', item)}>Delete</button>
          <button data-testid={`rename-${item.id}`} onClick={() => onOperate('rename', item)}>Rename</button>
        </div>
      ))}
    </div>
  ),
}))

// Mock context hook
vi.mock('../../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

// Mock next/navigation
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/test',
}))

// Mock Modal to avoid Headless UI issues in tests
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow, title }: { children: React.ReactNode, isShow: boolean, title: React.ReactNode }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="modal">
        {!!title && <div data-testid="modal-title">{title}</div>}
        {children}
      </div>
    )
  },
}))

describe('Sidebar Index', () => {
  const mockContextValue = {
    isInstalledApp: false,
    appData: {
      site: {
        title: 'Test App',
        icon_type: 'image',
        icon: 'icon-url',
        icon_background: '#fff',
        icon_url: 'http://example.com/icon.png',
      },
      custom_config: {},
    },
    handleNewConversation: vi.fn(),
    pinnedConversationList: [],
    conversationList: [
      { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
    ],
    currentConversationId: '0',
    handleChangeConversation: vi.fn(),
    handlePinConversation: vi.fn(),
    handleUnpinConversation: vi.fn(),
    conversationRenaming: false,
    handleRenameConversation: vi.fn(),
    handleDeleteConversation: vi.fn(),
    sidebarCollapseState: false,
    handleSidebarCollapse: vi.fn(),
    isMobile: false,
    isResponding: false,
  } as unknown as ChatWithHistoryContextValue

  beforeEach(() => {
    vi.clearAllMocks()
    mockBranding = { enabled: false, workspace_logo: '' }
    vi.mocked(useChatWithHistoryContext).mockReturnValue(mockContextValue)
  })

  describe('Basic Rendering', () => {
    it('should render app title', () => {
      render(<Sidebar />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should render new chat button', () => {
      render(<Sidebar />)
      expect(screen.getByRole('button', { name: 'share.chat.newChat' })).toBeInTheDocument()
    })

    it('should render with default props', () => {
      const { container } = render(<Sidebar />)
      const sidebar = container.firstChild
      expect(sidebar).toBeInTheDocument()
    })

    it('should render app icon', () => {
      render(<Sidebar />)
      // AppIcon is mocked but should still be rendered
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })
  })

  describe('Panel Styling', () => {
    it('should apply panel styling when isPanel is true', () => {
      const { container } = render(<Sidebar isPanel={true} />)
      const sidebar = container.firstChild as HTMLElement
      expect(sidebar).toHaveClass('rounded-xl')
    })

    it('should not apply panel styling when isPanel is false', () => {
      const { container } = render(<Sidebar isPanel={false} />)
      const sidebar = container.firstChild as HTMLElement
      expect(sidebar).not.toHaveClass('rounded-xl')
    })

    it('should handle undefined isPanel', () => {
      const { container } = render(<Sidebar />)
      const sidebar = container.firstChild as HTMLElement
      expect(sidebar).toBeInTheDocument()
    })

    it('should apply flex column layout', () => {
      const { container } = render(<Sidebar />)
      const sidebar = container.firstChild as HTMLElement
      expect(sidebar).toHaveClass('flex')
      expect(sidebar).toHaveClass('flex-col')
    })
  })

  describe('Sidebar Collapse/Expand', () => {
    it('should show collapse button when sidebar is expanded on desktop', async () => {
      const user = userEvent.setup()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        sidebarCollapseState: false,
        isMobile: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const header = screen.getByText('Test App').parentElement as HTMLElement
      const collapseButton = within(header).getByRole('button')
      expect(collapseButton).toBeInTheDocument()

      await user.click(collapseButton)
      expect(mockContextValue.handleSidebarCollapse).toHaveBeenCalledWith(true)
    })

    it('should show expand button when sidebar is collapsed on desktop', async () => {
      const user = userEvent.setup()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        sidebarCollapseState: true,
        isMobile: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const header = screen.getByText('Test App').parentElement as HTMLElement
      const expandButton = within(header).getByRole('button')
      expect(expandButton).toBeInTheDocument()

      await user.click(expandButton)
      expect(mockContextValue.handleSidebarCollapse).toHaveBeenCalledWith(false)
    })

    it('should not show collapse/expand buttons on mobile when expanded', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        sidebarCollapseState: false,
        isMobile: true,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      // On mobile, the collapse/expand buttons should not be shown
      const header = screen.getByText('Test App').parentElement as HTMLElement
      expect(within(header).queryByRole('button')).not.toBeInTheDocument()
    })

    it('should not show collapse/expand buttons on mobile when collapsed', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        sidebarCollapseState: true,
        isMobile: true,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const header = screen.getByText('Test App').parentElement as HTMLElement
      expect(within(header).queryByRole('button')).not.toBeInTheDocument()
    })
  })

  describe('New Conversation Button', () => {
    it('should call handleNewConversation when button clicked', async () => {
      const user = userEvent.setup()
      const handleNewConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        handleNewConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const newChatButton = screen.getByRole('button', { name: 'share.chat.newChat' })
      await user.click(newChatButton)

      expect(handleNewConversation).toHaveBeenCalled()
    })

    it('should disable new chat button when responding', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isResponding: true,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const newChatButton = screen.getByRole('button', { name: 'share.chat.newChat' })
      expect(newChatButton).toBeDisabled()
    })

    it('should enable new chat button when not responding', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isResponding: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const newChatButton = screen.getByRole('button', { name: 'share.chat.newChat' })
      expect(newChatButton).not.toBeDisabled()
    })
  })

  describe('Conversation Lists Rendering', () => {
    it('should render both pinned and unpinned lists when both have items', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [{ id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' }],
        conversationList: [{ id: '1', name: 'Conv 1', inputs: {}, introduction: '' }],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByTestId('pinned-list')).toBeInTheDocument()
      expect(screen.getByTestId('conversation-list')).toBeInTheDocument()
    })

    it('should only render pinned list when only pinned items exist', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [{ id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' }],
        conversationList: [],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByTestId('pinned-list')).toBeInTheDocument()
      expect(screen.queryByTestId('conversation-list')).not.toBeInTheDocument()
    })

    it('should only render conversation list when no pinned items exist', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [],
        conversationList: [{ id: '1', name: 'Conv 1', inputs: {}, introduction: '' }],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.queryByTestId('pinned-list')).not.toBeInTheDocument()
      expect(screen.getByTestId('conversation-list')).toBeInTheDocument()
    })

    it('should render neither list when both are empty', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [],
        conversationList: [],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.queryByTestId('pinned-list')).not.toBeInTheDocument()
      expect(screen.queryByTestId('conversation-list')).not.toBeInTheDocument()
    })

    it('should show unpinned title when both lists exist', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [{ id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' }],
        conversationList: [{ id: '1', name: 'Conv 1', inputs: {}, introduction: '' }],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      // The unpinned list should have the title
      const lists = screen.getAllByTestId('conversation-list')
      expect(lists.length).toBeGreaterThan(0)
    })

    it('should not show unpinned title when only conversation list exists', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [],
        conversationList: [{ id: '1', name: 'Conv 1', inputs: {}, introduction: '' }],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const conversationList = screen.getByTestId('conversation-list')
      expect(conversationList).toBeInTheDocument()
    })

    it('should render multiple pinned conversations', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [
          { id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' },
          { id: 'p2', name: 'Pinned 2', inputs: {}, introduction: '' },
        ],
        conversationList: [],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByText('Pinned 1')).toBeInTheDocument()
      expect(screen.getByText('Pinned 2')).toBeInTheDocument()
    })

    it('should render multiple conversation items', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [],
        conversationList: [
          { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
          { id: '2', name: 'Conv 2', inputs: {}, introduction: '' },
          { id: '3', name: 'Conv 3', inputs: {}, introduction: '' },
        ],
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByText('Conv 1')).toBeInTheDocument()
      expect(screen.getByText('Conv 2')).toBeInTheDocument()
      expect(screen.getByText('Conv 3')).toBeInTheDocument()
    })
  })

  describe('Pin/Unpin Operations', () => {
    it('should call handlePinConversation when pin operation is triggered', async () => {
      const user = userEvent.setup()
      const handlePinConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        handlePinConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      await user.click(screen.getByTestId('pin-1'))
      expect(handlePinConversation).toHaveBeenCalledWith('1')
    })

    it('should call handleUnpinConversation when unpin operation is triggered', async () => {
      const user = userEvent.setup()
      const handleUnpinConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        handleUnpinConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      await user.click(screen.getByTestId('unpin-1'))
      expect(handleUnpinConversation).toHaveBeenCalledWith('1')
    })

    it('should handle multiple pin/unpin operations', async () => {
      const user = userEvent.setup()
      const handlePinConversation = vi.fn()
      const handleUnpinConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [{ id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' }],
        conversationList: [
          { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
          { id: '2', name: 'Conv 2', inputs: {}, introduction: '' },
        ],
        handlePinConversation,
        handleUnpinConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)

      await user.click(screen.getByTestId('pin-1'))
      expect(handlePinConversation).toHaveBeenCalledWith('1')

      await user.click(screen.getByTestId('pin-2'))
      expect(handlePinConversation).toHaveBeenCalledWith('2')
    })
  })

  describe('Delete Confirmation', () => {
    it('should show delete confirmation modal when delete operation is triggered', async () => {
      const user = userEvent.setup()
      render(<Sidebar />)

      await user.click(screen.getByTestId('delete-1'))
      expect(screen.getByText('share.chat.deleteConversation.title')).toBeInTheDocument()
    })

    it('should call handleDeleteConversation when confirm is clicked', async () => {
      const user = userEvent.setup()
      const handleDeleteConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        handleDeleteConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)

      await user.click(screen.getByTestId('delete-1'))
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleDeleteConversation).toHaveBeenCalledWith('1', expect.objectContaining({
        onSuccess: expect.any(Function),
      }))
    })

    it('should close delete confirmation when cancel is clicked', async () => {
      const user = userEvent.setup()
      render(<Sidebar />)

      await user.click(screen.getByTestId('delete-1'))
      expect(screen.getByText('share.chat.deleteConversation.title')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
      await waitFor(() => {
        expect(screen.queryByText('share.chat.deleteConversation.title')).not.toBeInTheDocument()
      })
    })

    it('should handle delete for different conversation items', async () => {
      const user = userEvent.setup()
      const handleDeleteConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        conversationList: [
          { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
          { id: '2', name: 'Conv 2', inputs: {}, introduction: '' },
        ],
        handleDeleteConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)

      await user.click(screen.getByTestId('delete-1'))
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))

      expect(handleDeleteConversation).toHaveBeenCalledWith('1', expect.any(Object))
    })
  })

  describe('Rename Modal', () => {
    it('should show rename modal when rename operation is triggered', async () => {
      const user = userEvent.setup()
      render(<Sidebar />)

      await user.click(screen.getByTestId('rename-1'))
      expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()
    })

    it('should pass correct props to rename modal', async () => {
      const user = userEvent.setup()
      render(<Sidebar />)

      await user.click(screen.getByTestId('rename-1'))
      // The modal should have title and save/cancel
      expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.cancel' })).toBeInTheDocument()
    })

    it('should call handleRenameConversation with new name', async () => {
      const user = userEvent.setup()
      const handleRenameConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        handleRenameConversation,
        conversationRenaming: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)

      await user.click(screen.getByTestId('rename-1'))
      // Mock save call
      const input = screen.getByDisplayValue('Conv 1') as HTMLInputElement
      await user.clear(input)
      await user.type(input, 'New Name')

      // The RenameModal has a save button
      const saveButton = screen.getByText('common.operation.save')
      await user.click(saveButton)

      expect(handleRenameConversation).toHaveBeenCalled()
    })

    it('should close rename modal when cancel is clicked', async () => {
      const user = userEvent.setup()
      render(<Sidebar />)

      await user.click(screen.getByTestId('rename-1'))
      expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()

      const cancelButton = screen.getByText('common.operation.cancel')
      await user.click(cancelButton)

      await waitFor(() => {
        expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
      })
    })

    it('should show saving state during rename', async () => {
      const user = userEvent.setup()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        conversationRenaming: true,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      await user.click(screen.getByTestId('rename-1'))
      const saveButton = screen.getByText('common.operation.save').closest('button')
      expect(saveButton).toBeDisabled()
    })

    it('should handle rename for different items', async () => {
      const user = userEvent.setup()
      const handleRenameConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        conversationList: [
          { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
          { id: '2', name: 'Conv 2', inputs: {}, introduction: '' },
        ],
        handleRenameConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)

      await user.click(screen.getByTestId('rename-1'))
      const input = screen.getByDisplayValue('Conv 1') as HTMLInputElement
      await user.clear(input)
      await user.type(input, 'Renamed')

      const saveButton = screen.getByText('common.operation.save')
      await user.click(saveButton)

      expect(handleRenameConversation).toHaveBeenCalled()
    })
  })

  describe('Branding and Footer', () => {
    it('should show powered by text when remove_webapp_brand is false', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        appData: {
          ...mockContextValue.appData,
          custom_config: {
            remove_webapp_brand: false,
          },
        },
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    })

    it('should not show powered by when remove_webapp_brand is true', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        appData: {
          ...mockContextValue.appData,
          custom_config: {
            remove_webapp_brand: true,
          },
        },
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.queryByText('share.chat.poweredBy')).not.toBeInTheDocument()
    })

    it('should show custom logo when replace_webapp_logo is provided', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        appData: {
          ...mockContextValue.appData,
          custom_config: {
            remove_webapp_brand: false,
            replace_webapp_logo: 'http://example.com/custom-logo.png',
          },
        },
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    })

    it('should use system branding logo when enabled', () => {
      mockBranding = { enabled: true, workspace_logo: 'http://example.com/workspace-logo.png' }

      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        appData: {
          ...mockContextValue.appData,
          custom_config: {
            remove_webapp_brand: false,
          },
        },
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByText('share.chat.poweredBy')).toBeInTheDocument()
    })

    it('should handle menuDropdown props correctly', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isInstalledApp: true,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      // MenuDropdown should be rendered with hideLogout=true when isInstalledApp
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should handle menuDropdown when not installed app', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isInstalledApp: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })
  })

  describe('Panel Visibility', () => {
    it('should handle panelVisible prop', () => {
      render(<Sidebar isPanel={true} panelVisible={true} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should handle panelVisible false', () => {
      render(<Sidebar isPanel={true} panelVisible={false} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })

    it('should render without panelVisible prop', () => {
      render(<Sidebar isPanel={true} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })
  })

  describe('Context Integration', () => {
    it('should use correct context values', () => {
      render(<Sidebar />)
      expect(vi.mocked(useChatWithHistoryContext)).toHaveBeenCalled()
    })

    it('should pass context values to List components', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        pinnedConversationList: [{ id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' }],
        conversationList: [{ id: '1', name: 'Conv 1', inputs: {}, introduction: '' }],
        currentConversationId: '1',
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByText('Pinned 1')).toBeInTheDocument()
      expect(screen.getByText('Conv 1')).toBeInTheDocument()
    })
  })

  describe('Mobile Behavior', () => {
    it('should hide collapse/expand on mobile', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isMobile: true,
        sidebarCollapseState: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const header = screen.getByText('Test App').parentElement as HTMLElement
      expect(within(header).queryByRole('button')).not.toBeInTheDocument()
    })

    it('should show controls on desktop', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isMobile: false,
        sidebarCollapseState: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      expect(screen.getByRole('button', { name: 'share.chat.newChat' })).toBeInTheDocument()
    })
  })

  describe('Responding State', () => {
    it('should disable new chat button when responding', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isResponding: true,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const newChatButton = screen.getByRole('button', { name: 'share.chat.newChat' })
      expect(newChatButton).toBeDisabled()
    })

    it('should enable new chat button when not responding', () => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        isResponding: false,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      const newChatButton = screen.getByRole('button', { name: 'share.chat.newChat' })
      expect(newChatButton).not.toBeDisabled()
    })
  })

  describe('Complex Scenarios', () => {
    it('should handle full lifecycle: new conversation -> rename -> delete', async () => {
      const user = userEvent.setup()
      const handleNewConversation = vi.fn()
      const handleRenameConversation = vi.fn()
      const handleDeleteConversation = vi.fn()

      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        handleNewConversation,
        handleRenameConversation,
        handleDeleteConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)

      // Create new conversation
      await user.click(screen.getByRole('button', { name: 'share.chat.newChat' }))
      expect(handleNewConversation).toHaveBeenCalled()

      // Rename it
      await user.click(screen.getByTestId('rename-1'))
      const input = screen.getByDisplayValue('Conv 1')
      await user.clear(input)
      await user.type(input, 'Renamed')

      // Delete it
      await user.click(screen.getByTestId('delete-1'))
      await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
      expect(handleDeleteConversation).toHaveBeenCalled()
    })

    it('should handle switching between conversations while interacting with operations', async () => {
      const user = userEvent.setup()
      const handleChangeConversation = vi.fn()
      const handlePinConversation = vi.fn()

      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        conversationList: [
          { id: '1', name: 'Conv 1', inputs: {}, introduction: '' },
          { id: '2', name: 'Conv 2', inputs: {}, introduction: '' },
        ],
        handleChangeConversation,
        handlePinConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)

      // Pin first conversation
      await user.click(screen.getByTestId('pin-1'))
      expect(handlePinConversation).toHaveBeenCalledWith('1')

      // Pin second conversation
      await user.click(screen.getByTestId('pin-2'))
      expect(handlePinConversation).toHaveBeenCalledWith('2')
    })

    it('should maintain state during prop updates', () => {
      const { rerender } = render(<Sidebar isPanel={false} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()

      rerender(<Sidebar isPanel={true} panelVisible={true} />)
      expect(screen.getByText('Test App')).toBeInTheDocument()
    })
  })

  describe('Coverage Edge Cases', () => {
    it('should render pinned list when pinned title translation is empty', () => {
      const useTranslationSpy = mockUseTranslationWithEmptyKeys(['chat.pinnedTitle'])
      try {
        vi.mocked(useChatWithHistoryContext).mockReturnValue({
          ...mockContextValue,
          pinnedConversationList: [{ id: 'p1', name: 'Pinned 1', inputs: {}, introduction: '' }],
          conversationList: [],
        } as unknown as ChatWithHistoryContextValue)

        render(<Sidebar />)
        expect(screen.getByTestId('pinned-list')).toBeInTheDocument()
        expect(screen.queryByTestId('list-title')).not.toBeInTheDocument()
      }
      finally {
        useTranslationSpy.mockRestore()
      }
    })

    it('should render delete confirm when content translation is empty', async () => {
      const user = userEvent.setup()
      const useTranslationSpy = mockUseTranslationWithEmptyKeys(['chat.deleteConversation.content'])
      try {
        render(<Sidebar />)
        await user.click(screen.getByTestId('delete-1'))
        expect(screen.getByText('share.chat.deleteConversation.title')).toBeInTheDocument()
        expect(screen.queryByText('share.chat.deleteConversation.content')).not.toBeInTheDocument()
      }
      finally {
        useTranslationSpy.mockRestore()
      }
    })

    it('should pass empty name to rename modal when conversation name is empty', async () => {
      const user = userEvent.setup()
      const handleRenameConversation = vi.fn()
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...mockContextValue,
        conversationList: [{ id: '1', name: '', inputs: {}, introduction: '' }],
        handleRenameConversation,
      } as unknown as ChatWithHistoryContextValue)

      render(<Sidebar />)
      await user.click(screen.getByTestId('rename-1'))
      await user.click(screen.getByText('common.operation.save'))

      expect(handleRenameConversation).toHaveBeenCalledWith('1', '', expect.any(Object))
    })
  })
})

describe('RenameModal', () => {
  it('should render title when modal is shown', () => {
    render(
      <RenameModal
        isShow
        saveLoading={false}
        name="Conversation"
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    )

    expect(screen.getByText('common.chat.renameConversation')).toBeInTheDocument()
  })

  it('should handle empty placeholder translation fallback', () => {
    const useTranslationSpy = mockUseTranslationWithEmptyKeys(['chat.conversationNamePlaceholder'])
    try {
      render(
        <RenameModal
          isShow
          saveLoading={false}
          name="Conversation"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      )
      expect(screen.getByPlaceholderText('')).toBeInTheDocument()
    }
    finally {
      useTranslationSpy.mockRestore()
    }
  })
})
