import type { ChatWithHistoryContextValue } from '../../context'
import type { AppData, ConversationItem } from '@/models/share'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { InputVarType } from '@/app/components/workflow/types'
import { ChatWithHistoryContext, useChatWithHistoryContext } from '../../context'
import Header from '../index'

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

const conversation = (overrides: Partial<ConversationItem> = {}): ConversationItem => ({
  id: 'conv-1',
  name: 'My Chat',
  inputs: {},
  introduction: '',
  ...overrides,
})
const setup = (overrides: Partial<ChatWithHistoryContextValue> = {}) => {
  function Provider() {
    const defaults = useChatWithHistoryContext()
    return (
      <ChatWithHistoryContext.Provider
        value={{ ...defaults, ...mockContextDefaults, ...overrides }}
      >
        <Header />
      </ChatWithHistoryContext.Provider>
    )
  }
  return render(<Provider />)
}

describe('Header Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => vi.restoreAllMocks())

  describe('Rendering', () => {
    it('opens chat settings with the conversation inputs', async () => {
      const user = userEvent.setup()
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        inputsForms: [
          { type: InputVarType.textInput, label: 'Topic', variable: 'topic', required: false },
        ],
        currentConversationInputs: { topic: 'Travel' },
      })

      await user.click(screen.getByRole('button', { name: 'share.chat.viewChatSettings' }))
      expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Travel')
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should handle new conversation', async () => {
      const user = userEvent.setup()
      const handleNewConversation = vi.fn()
      setup({ handleNewConversation, sidebarCollapseState: true, currentConversationId: 'conv-1' })

      const resetChatBtn = screen.getByRole('button', { name: 'share.chat.resetChat' })
      await user.click(resetChatBtn)

      expect(handleNewConversation).toHaveBeenCalled()
    })

    it('should handle sidebar toggle', async () => {
      const user = userEvent.setup()
      const handleSidebarCollapse = vi.fn()
      setup({ handleSidebarCollapse, sidebarCollapseState: true })

      const sidebarBtn = screen.getByRole('button', { name: 'layout.sidebar.expandSidebar' })
      await user.click(sidebarBtn)

      expect(handleSidebarCollapse).toHaveBeenCalledWith(false)
    })

    it('should render operation menu and handle pin', async () => {
      const user = userEvent.setup()
      const handlePinConversation = vi.fn()
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handlePinConversation,
        sidebarCollapseState: true,
      })

      const trigger = screen.getByText('My Chat')
      await user.click(trigger)

      const pinBtn = await screen.findByText('explore.sidebar.action.pin')
      expect(pinBtn)!.toBeInTheDocument()

      await user.click(pinBtn)

      expect(handlePinConversation).toHaveBeenCalledWith('conv-1')
    })

    it('should handle unpin', async () => {
      const user = userEvent.setup()
      const handleUnpinConversation = vi.fn()
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handleUnpinConversation,
        pinnedConversationList: [conversation()],
        sidebarCollapseState: true,
      })

      await user.click(screen.getByText('My Chat'))

      const unpinBtn = await screen.findByText('explore.sidebar.action.unpin')
      await user.click(unpinBtn)

      expect(handleUnpinConversation).toHaveBeenCalledWith('conv-1')
    })

    it('should handle rename cancellation', async () => {
      const user = userEvent.setup()
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        sidebarCollapseState: true,
      })

      await user.click(screen.getByText('My Chat'))

      const renameMenuBtn = await screen.findByText('explore.sidebar.action.rename')
      await user.click(renameMenuBtn)

      const cancelBtn = await screen.findByText('common.operation.cancel')
      await user.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
      })
      expect(mockContextDefaults.handleRenameConversation).not.toHaveBeenCalled()
    })

    it('should handle rename success flow', async () => {
      const user = userEvent.setup()
      const handleRenameConversation = vi.fn()
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handleRenameConversation,
        sidebarCollapseState: true,
      })

      await user.click(screen.getByText('My Chat'))

      const renameMenuBtn = await screen.findByText('explore.sidebar.action.rename')
      await user.click(renameMenuBtn)

      expect(await screen.findByText('common.chat.renameConversation'))!.toBeInTheDocument()

      const input = screen.getByDisplayValue('My Chat')
      await user.clear(input)
      await user.type(input, 'New Name')

      const saveBtn = await screen.findByText('common.operation.save')
      await user.click(saveBtn)

      expect(handleRenameConversation).toHaveBeenCalledWith(
        'conv-1',
        'New Name',
        expect.any(Object),
      )

      const successCallback = handleRenameConversation.mock.calls[0]![2].onSuccess
      await act(async () => {
        successCallback()
      })

      await waitFor(() => {
        expect(screen.queryByText('common.chat.renameConversation')).not.toBeInTheDocument()
      })
    })

    it('should handle delete flow', async () => {
      const user = userEvent.setup()
      const handleDeleteConversation = vi.fn()
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        handleDeleteConversation,
        sidebarCollapseState: true,
      })

      await user.click(screen.getByText('My Chat'))

      const deleteMenuBtn = await screen.findByText('explore.sidebar.action.delete')
      await user.click(deleteMenuBtn)

      expect(handleDeleteConversation).not.toHaveBeenCalled()
      expect(await screen.findByText('share.chat.deleteConversation.title'))!.toBeInTheDocument()

      const confirmBtn = await screen.findByText('common.operation.confirm')
      await user.click(confirmBtn)

      expect(handleDeleteConversation).toHaveBeenCalledWith('conv-1', expect.any(Object))

      const successCallback = handleDeleteConversation.mock.calls[0]![1].onSuccess
      await act(async () => {
        successCallback()
      })

      await waitFor(() => {
        expect(screen.queryByText('share.chat.deleteConversation.title')).not.toBeInTheDocument()
      })
    })

    it('should handle delete cancellation', async () => {
      const user = userEvent.setup()
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        sidebarCollapseState: true,
      })

      await user.click(screen.getByText('My Chat'))

      const deleteMenuBtn = await screen.findByText('explore.sidebar.action.delete')
      await user.click(deleteMenuBtn)

      const cancelBtn = await screen.findByText('common.operation.cancel')
      await user.click(cancelBtn)

      await waitFor(() => {
        expect(screen.queryByText('share.chat.deleteConversation.title')).not.toBeInTheDocument()
      })
      expect(mockContextDefaults.handleDeleteConversation).not.toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should not render inputs form dropdown if inputsForms is empty', () => {
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        inputsForms: [],
      })

      expect(
        screen.queryByRole('button', { name: 'share.chat.viewChatSettings' }),
      ).not.toBeInTheDocument()
    })

    it('should render system title if conversation id is missing', () => {
      setup({ currentConversationId: '', sidebarCollapseState: true })
      const titleEl = screen.getByText('Test App')
      expect(titleEl).toBeInTheDocument()
    })

    it('should render app icon from URL when icon_url is provided', () => {
      vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
      vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(32)
      const { container } = setup({
        appData: {
          ...mockAppData,
          site: {
            ...mockAppData.site,
            icon_type: 'image',
            icon_url: 'https://example.com/icon.png',
          },
        },
      })
      expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/icon.png')
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('should handle New Chat button state when currentConversationId is present but isResponding is true', () => {
      setup({
        isResponding: true,
        sidebarCollapseState: true,
        currentConversationId: 'conv-1',
      })

      const newChatBtn = screen.getByRole('button', { name: 'share.chat.newChatTip' })
      expect(newChatBtn).toBeDisabled()
    })

    it('should handle New Chat button state when currentConversationId is missing and isResponding is false', () => {
      setup({
        isResponding: false,
        sidebarCollapseState: true,
        currentConversationId: '',
      })

      const newChatBtn = screen.getByRole('button', { name: 'share.chat.newChatTip' })
      expect(newChatBtn).toBeDisabled()
    })

    it('should not render operation menu if conversation id is missing', () => {
      setup({ currentConversationId: '', sidebarCollapseState: true })
      expect(screen.queryByText('My Chat')).not.toBeInTheDocument()
    })

    it('should not render operation menu if sidebar is NOT collapsed', () => {
      const mockConv = conversation()
      setup({
        currentConversationId: 'conv-1',
        currentConversationItem: mockConv,
        sidebarCollapseState: false,
      })
      expect(screen.queryByText('My Chat')).not.toBeInTheDocument()
    })
  })
})
