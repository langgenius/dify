import type { ChatWithHistoryContextValue } from '../context'
import type { AppData, ConversationItem } from '@/models/share'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatWithHistoryContext } from '../context'
import Header from './index'

vi.mock('../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

const mockAppData: AppData = {
  app_id: 'app-1',
  site: {
    title: 'Test App',
    icon_type: 'emoji',
    icon: '🤖',
    icon_background: '#fff',
  },
  end_user_id: 'user-1',
  custom_config: null,
}

const mockContextDefaults: Partial<ChatWithHistoryContextValue> = {
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
}

const setup = (overrides: Partial<ChatWithHistoryContextValue> = {}) => {
  vi.mocked(useChatWithHistoryContext).mockReturnValue({
    ...mockContextDefaults,
    ...overrides,
  } as ChatWithHistoryContextValue)
  return render(<Header />)
}

const SIDEBAR_ICON = 'M21 3C21.5523 3 22 3.44772'
const NEW_CHAT_ICON = 'M16.7574 2.99678L14.7574 4.99678'
const RESET_CHAT_ICON = 'M22 12C22 17.5228'

const getButtonByIcon = (pathStart: string) => {
  return screen.getAllByRole('button').find((b) => {
    const path = b.querySelector('path')
    return path?.getAttribute('d')?.includes(pathStart)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Header Component', () => {
  describe('Rendering', () => {
    it('should render app title and app icon when no conversation is selected', async () => {
      setup()
      expect(await screen.findByText('Test App')).toBeInTheDocument()
      expect(screen.getByText('🤖')).toBeInTheDocument()
    })

    it('should show conversation title when a conversation is active', async () => {
      const mockConv: ConversationItem = { id: 'conv-1', name: 'My Chat', inputs: null, introduction: '' }
      setup({ currentConversationId: 'conv-1', currentConversationItem: mockConv })
      expect(await screen.findByText('My Chat')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should invoke handleSidebarCollapse when sidebar button is clicked', async () => {
      const handleSidebarCollapse = vi.fn()
      setup({ handleSidebarCollapse, sidebarCollapseState: true })
      const user = userEvent.setup()
      const btn = getButtonByIcon(SIDEBAR_ICON)
      await user.click(btn!)
      expect(handleSidebarCollapse).toHaveBeenCalledWith(false)
    })

    it('should call handleNewConversation when new chat button is clicked', async () => {
      const handleNewConversation = vi.fn()
      setup({ handleNewConversation, sidebarCollapseState: true, currentConversationId: 'conv-1' })
      const user = userEvent.setup()
      const btn = getButtonByIcon(NEW_CHAT_ICON)
      await user.click(btn!)
      await waitFor(() => expect(handleNewConversation).toHaveBeenCalled())
    })

    it('should disable new chat button when the chat is responding', async () => {
      setup({ isResponding: true, sidebarCollapseState: true, currentConversationId: 'conv-1' })
      const btn = getButtonByIcon(NEW_CHAT_ICON)
      expect(btn).toBeDisabled()
    })

    it('should call handleNewConversation when reset chat button is clicked', async () => {
      const handleNewConversation = vi.fn()
      setup({ currentConversationId: 'conv-1', handleNewConversation })
      const user = userEvent.setup()
      const btn = getButtonByIcon(RESET_CHAT_ICON)
      await user.click(btn!)
      await waitFor(() => expect(handleNewConversation).toHaveBeenCalled())
    })
  })

  describe('Operation Flow', () => {
    it('should handle pin flow correctly when user selects pin', async () => {
      const handlePinConversation = vi.fn()
      const mockConv: ConversationItem = { id: 'conv-1', name: 'My Chat', inputs: null, introduction: '' }
      setup({ currentConversationId: 'conv-1', currentConversationItem: mockConv, handlePinConversation, pinnedConversationList: [] })

      const user = userEvent.setup()
      await user.click(await screen.findByText('My Chat'))
      await user.click(await screen.findByText('explore.sidebar.action.pin'))
      expect(handlePinConversation).toHaveBeenCalledWith('conv-1')
    })

    it('should handle unpin flow correctly when conversation is pinned', async () => {
      const handleUnpinConversation = vi.fn()
      const mockConv: ConversationItem = { id: 'conv-1', name: 'My Chat', inputs: null, introduction: '' }
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handleUnpinConversation,
        pinnedConversationList: [{ id: 'conv-1' } as ConversationItem],
      })

      const user = userEvent.setup()
      await user.click(await screen.findByText('My Chat'))
      await user.click(await screen.findByText('explore.sidebar.action.unpin'))
      expect(handleUnpinConversation).toHaveBeenCalledWith('conv-1')
    })

    it('should manage rename modal lifecycle correctly', async () => {
      const handleRenameConversation = vi.fn()
      const mockConv: ConversationItem = { id: 'conv-1', name: 'My Chat', inputs: null, introduction: '' }
      setup({ currentConversationId: 'conv-1', currentConversationItem: mockConv, handleRenameConversation })

      const user = userEvent.setup()
      await user.click(await screen.findByText('My Chat'))
      await user.click(await screen.findByText('explore.sidebar.action.rename'))

      expect(await screen.findByText('common.chat.renameConversation')).toBeInTheDocument()

      await user.click(screen.getByText('common.operation.cancel'))
      await waitFor(() => expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument())

      await user.click(await screen.findByText('My Chat'))
      await user.click(await screen.findByText('explore.sidebar.action.rename'))

      const input = await screen.findByPlaceholderText('common.chat.conversationNamePlaceholder')
      fireEvent.change(input, { target: { value: 'New Name' } })
      await user.click(screen.getByText('common.operation.save'))

      await waitFor(() => {
        expect(handleRenameConversation).toHaveBeenCalledWith('conv-1', 'New Name', expect.any(Object))
      })
    })

    it('should manage delete confirmation lifecycle correctly', async () => {
      const handleDeleteConversation = vi.fn()
      const mockConv: ConversationItem = { id: 'conv-1', name: 'My Chat', inputs: null, introduction: '' }
      setup({ currentConversationId: 'conv-1', currentConversationItem: mockConv, handleDeleteConversation })

      const user = userEvent.setup()
      await user.click(await screen.findByText('My Chat'))
      await user.click(await screen.findByText('explore.sidebar.action.delete'))

      expect(await screen.findByText('share.chat.deleteConversation.title')).toBeInTheDocument()

      await user.click(screen.getByText('common.operation.cancel'))
      await waitFor(() => expect(screen.queryByText('share.chat.deleteConversation.title')).not.toBeInTheDocument())

      await user.click(await screen.findByText('My Chat'))
      await user.click(await screen.findByText('explore.sidebar.action.delete'))
      await user.click(screen.getByText('common.operation.confirm'))

      expect(handleDeleteConversation).toHaveBeenCalledWith('conv-1', expect.any(Object))
    })
  })

  describe('Edge Cases & Styling', () => {
    it('should apply proper styling when sidebar is not collapsed', async () => {
      setup({ sidebarCollapseState: false })
      const btn = getButtonByIcon(SIDEBAR_ICON)
      expect(btn).toHaveClass('cursor-default')
    })

    it('should render ViewFormDropdown when inputsForms exist', async () => {
      const { container } = setup({ currentConversationId: 'conv-1', inputsForms: [{}] })
      expect(container.querySelector('.remixicon')).toBeInTheDocument()
    })
  })
})
