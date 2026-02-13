import type { ChatWithHistoryContextValue } from '../context'
import type { AppData, ConversationItem } from '@/models/share'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatWithHistoryContext } from '../context'
import Header from './index'

// Mock context module
vi.mock('../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

// Mock InputsFormContent
vi.mock('@/app/components/base/chat/chat-with-history/inputs-form/content', () => ({
  default: () => <div data-testid="inputs-form-content">InputsFormContent</div>,
}))

// Mock PortalToFollowElem using React Context
vi.mock('@/app/components/base/portal-to-follow-elem', async () => {
  const React = await import('react')
  const MockContext = React.createContext(false)

  return {
    PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => {
      return (
        <MockContext.Provider value={open}>
          <div data-open={open}>{children}</div>
        </MockContext.Provider>
      )
    },
    PortalToFollowElemContent: ({ children }: { children: React.ReactNode }) => {
      const open = React.useContext(MockContext)
      if (!open)
        return null
      return <div>{children}</div>
    },
    PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
      <div onClick={onClick}>{children}</div>
    ),
  }
})

// Mock Modal to avoid Headless UI issues in tests
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow, title }: { children: React.ReactNode, isShow: boolean, title: React.ReactNode }) => {
    if (!isShow)
      return null
    return (
      <div data-testid="modal">
        {!!title && <div>{title}</div>}
        {children}
      </div>
    )
  },
}))

const mockAppData: AppData = {
  app_id: 'app-1',
  site: {
    title: 'Test App',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#fff',
    icon_url: '',
  },
  end_user_id: 'user-1',
  custom_config: null,
  can_replace_logo: false,
}

const mockContextDefaults: ChatWithHistoryContextValue = {
  appData: mockAppData,
  currentConversationId: '',
  currentConversationItem: undefined,
  inputsForms: [],
  pinnedConversationList: [],
  handlePinConversation: vi.fn(),
  handleUnpinConversation: vi.fn(),
  handleRenameConversation: vi.fn(),
  handleDeleteConversation: vi.fn(),
  handleNewConversation: vi.fn(),
  sidebarCollapseState: true,
  handleSidebarCollapse: vi.fn(),
  isResponding: false,
  conversationRenaming: false,
  showConfig: false,
} as unknown as ChatWithHistoryContextValue

const setup = (overrides: Partial<ChatWithHistoryContextValue> = {}) => {
  vi.mocked(useChatWithHistoryContext).mockReturnValue({
    ...mockContextDefaults,
    ...overrides,
  })
  return render(<Header />)
}

describe('Header Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render conversation name when conversation is selected', () => {
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        sidebarCollapseState: true,
      })
      expect(screen.getByText('My Chat')).toBeInTheDocument()
    })

    it('should render ViewFormDropdown trigger when inputsForms are present', () => {
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        inputsForms: [{ id: 'form-1' }],
      })

      const buttons = screen.getAllByRole('button')
      // Sidebar(1) + NewChat(1) + ResetChat(1) + ViewForm(1) = 4 buttons
      expect(buttons).toHaveLength(4)
    })
  })

  describe('Interactions', () => {
    it('should handle new conversation', async () => {
      const handleNewConversation = vi.fn()
      setup({ handleNewConversation, sidebarCollapseState: true, currentConversationId: 'conv-1' })

      const buttons = screen.getAllByRole('button')
      // Sidebar, NewChat, ResetChat (3)
      const resetChatBtn = buttons[buttons.length - 1]
      await userEvent.click(resetChatBtn)

      expect(handleNewConversation).toHaveBeenCalled()
    })

    it('should handle sidebar toggle', async () => {
      const handleSidebarCollapse = vi.fn()
      setup({ handleSidebarCollapse, sidebarCollapseState: true })

      const buttons = screen.getAllByRole('button')
      const sidebarBtn = buttons[0]
      await userEvent.click(sidebarBtn)

      expect(handleSidebarCollapse).toHaveBeenCalledWith(false)
    })

    it('should render operation menu and handle pin', async () => {
      const handlePinConversation = vi.fn()
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handlePinConversation,
        sidebarCollapseState: true,
      })

      const trigger = screen.getByText('My Chat')
      await userEvent.click(trigger)

      const pinBtn = await screen.findByText('explore.sidebar.action.pin')
      expect(pinBtn).toBeInTheDocument()

      await userEvent.click(pinBtn)

      expect(handlePinConversation).toHaveBeenCalledWith('conv-1')
    })

    it('should handle unpin', async () => {
      const handleUnpinConversation = vi.fn()
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handleUnpinConversation,
        pinnedConversationList: [{ id: 'conv-1' } as ConversationItem],
        sidebarCollapseState: true,
      })

      await userEvent.click(screen.getByText('My Chat'))

      const unpinBtn = await screen.findByText('explore.sidebar.action.unpin')
      await userEvent.click(unpinBtn)

      expect(handleUnpinConversation).toHaveBeenCalledWith('conv-1')
    })

    it('should handle rename cancellation', async () => {
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        sidebarCollapseState: true,
      })

      await userEvent.click(screen.getByText('My Chat'))

      const renameMenuBtn = await screen.findByText('explore.sidebar.action.rename')
      await userEvent.click(renameMenuBtn)

      const cancelBtn = await screen.findByText('common.operation.cancel')
      await userEvent.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
      })
    })

    it('should handle rename success flow', async () => {
      const handleRenameConversation = vi.fn()
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handleRenameConversation,
        sidebarCollapseState: true,
      })

      await userEvent.click(screen.getByText('My Chat'))

      const renameMenuBtn = await screen.findByText('explore.sidebar.action.rename')
      await userEvent.click(renameMenuBtn)

      expect(await screen.findByText('common.chat.renameConversation')).toBeInTheDocument()

      const input = screen.getByDisplayValue('My Chat')
      await userEvent.clear(input)
      await userEvent.type(input, 'New Name')

      const saveBtn = await screen.findByText('common.operation.save')
      await userEvent.click(saveBtn)

      expect(handleRenameConversation).toHaveBeenCalledWith('conv-1', 'New Name', expect.any(Object))

      const successCallback = handleRenameConversation.mock.calls[0][2].onSuccess
      successCallback()

      await waitFor(() => {
        expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
      })
    })

    it('should handle delete flow', async () => {
      const handleDeleteConversation = vi.fn()
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handleDeleteConversation,
        sidebarCollapseState: true,
      })

      await userEvent.click(screen.getByText('My Chat'))

      const deleteMenuBtn = await screen.findByText('explore.sidebar.action.delete')
      await userEvent.click(deleteMenuBtn)

      expect(handleDeleteConversation).not.toHaveBeenCalled()
      expect(await screen.findByText('share.chat.deleteConversation.title')).toBeInTheDocument()

      const confirmBtn = await screen.findByText('common.operation.confirm')
      await userEvent.click(confirmBtn)

      expect(handleDeleteConversation).toHaveBeenCalledWith('conv-1', expect.any(Object))

      const successCallback = handleDeleteConversation.mock.calls[0][1].onSuccess
      successCallback()

      await waitFor(() => {
        expect(screen.queryByText('share.chat.deleteConversation.title')).not.toBeInTheDocument()
      })
    })

    it('should handle delete cancellation', async () => {
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        sidebarCollapseState: true,
      })

      await userEvent.click(screen.getByText('My Chat'))

      const deleteMenuBtn = await screen.findByText('explore.sidebar.action.delete')
      await userEvent.click(deleteMenuBtn)

      const cancelBtn = await screen.findByText('common.operation.cancel')
      await userEvent.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByText('share.chat.deleteConversation.title')).not.toBeInTheDocument()
      })
    })
  })

  describe('Edge Cases', () => {
    it('should not render inputs form dropdown if inputsForms is empty', () => {
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        inputsForms: [],
      })

      const buttons = screen.getAllByRole('button')
      // Sidebar(1) + NewChat(1) + ResetChat(1) = 3 buttons
      expect(buttons).toHaveLength(3)
    })

    it('should render system title if conversation id is missing', () => {
      setup({ currentConversationId: '', sidebarCollapseState: true })
      const titleEl = screen.getByText('Test App')
      expect(titleEl).toHaveClass('system-md-semibold')
    })

    it('should not render operation menu if conversation id is missing', () => {
      setup({ currentConversationId: '', sidebarCollapseState: true })
      expect(screen.queryByText('My Chat')).not.toBeInTheDocument()
    })

    it('should not render operation menu if sidebar is NOT collapsed', () => {
      const mockConv = { id: 'conv-1', name: 'My Chat' } as ConversationItem
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        sidebarCollapseState: false,
      })
      expect(screen.queryByText('My Chat')).not.toBeInTheDocument()
    })

    it('should handle New Chat button disabled state when responding', () => {
      setup({
        isResponding: true,
        sidebarCollapseState: true,
        currentConversationId: undefined,
      })

      const buttons = screen.getAllByRole('button')
      // Sidebar(1) + NewChat(1) = 2
      const newChatBtn = buttons[1]
      expect(newChatBtn).toBeDisabled()
    })
  })
})
