import type { RefObject } from 'react'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import ChatWithHistory from '@/app/components/base/chat/chat-with-history'
import { useChatWithHistoryContext } from '@/app/components/base/chat/chat-with-history/context'
import { useChatWithHistory } from '@/app/components/base/chat/chat-with-history/hooks'
import useBreakpoints, { MediaType } from '@/hooks/use-breakpoints'
import useDocumentTitle from '@/hooks/use-document-title'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'

vi.mock('@/app/components/base/chat/chat-with-history/hooks', () => ({
  useChatWithHistory: vi.fn(),
}))

vi.mock('@/app/components/base/chat/chat-with-history/chat-wrapper', () => {
  const ChatThemeProbe = () => {
    const { theme } = useChatWithHistoryContext()

    return (
      <span aria-label="chat theme">
        {theme?.primaryColor}:{String(theme?.chatColorThemeInverted)}
      </span>
    )
  }

  return { default: ChatThemeProbe }
})

vi.mock('@/hooks/use-breakpoints', () => ({
  default: vi.fn(),
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({})),
}))

type HookReturn = ReturnType<typeof useChatWithHistory>

const mockAppData = {
  site: { title: 'Test Chat', chat_color_theme: 'blue', chat_color_theme_inverted: false },
} as unknown as AppData

const defaultHookReturn: HookReturn = {
  isInstalledApp: false,
  appId: 'test-app-id',
  currentConversationId: '',
  currentConversationItem: undefined,
  handleConversationIdInfoChange: vi.fn(),
  appData: mockAppData,
  appParams: {} as ChatConfig,
  appMeta: {} as AppMeta,
  appPinnedConversationData: {
    data: [] as ConversationItem[],
    has_more: false,
    limit: 20,
  } as AppConversationData,
  appConversationData: {
    data: [] as ConversationItem[],
    has_more: false,
    limit: 20,
  } as AppConversationData,
  appConversationDataLoading: false,
  appChatListData: {
    data: [] as ConversationItem[],
    has_more: false,
    limit: 20,
  } as AppConversationData,
  appChatListDataLoading: false,
  appPrevChatTree: [],
  pinnedConversationList: [],
  conversationList: [],
  setShowNewConversationItemInList: vi.fn(),
  newConversationInputs: {},
  newConversationInputsRef: { current: {} } as unknown as RefObject<Record<string, unknown>>,
  handleNewConversationInputsChange: vi.fn(),
  inputsForms: [],
  handleNewConversation: vi.fn(),
  handleStartChat: vi.fn(),
  handleChangeConversation: vi.fn(),
  handlePinConversation: vi.fn(),
  handleUnpinConversation: vi.fn(),
  conversationDeleting: false,
  handleDeleteConversation: vi.fn(),
  conversationRenaming: false,
  handleRenameConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  newConversationId: '',
  chatShouldReloadKey: 'test-reload-key',
  handleFeedback: vi.fn(),
  currentChatInstanceRef: { current: { handleStop: vi.fn() } },
  sidebarCollapseState: false,
  handleSidebarCollapse: vi.fn(),
  clearChatList: false,
  setClearChatList: vi.fn(),
  isResponding: false,
  setIsResponding: vi.fn(),
  currentConversationInputs: {},
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  initUserVariables: {},
}

describe('Base Chat Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useBreakpoints).mockReturnValue(MediaType.pc)
    vi.mocked(useChatWithHistory).mockReturnValue(defaultHookReturn)
  })

  // Chat-with-history shell integration across layout, responsive shell, and theme setup.
  describe('Chat With History Shell', () => {
    it('updates the document title and expands the collapsed desktop sidebar on hover', () => {
      const { container } = render(<ChatWithHistory className="chat-history-shell" />)

      const titles = screen.getAllByText('Test Chat')
      expect(titles.length).toBeGreaterThan(0)
      expect(useDocumentTitle).toHaveBeenCalledWith('Test Chat')

      vi.mocked(useChatWithHistory).mockReturnValue({
        ...defaultHookReturn,
        sidebarCollapseState: true,
      })

      const { container: collapsedContainer } = render(<ChatWithHistory />)
      const hoverArea = collapsedContainer.querySelector('.absolute.top-0.z-20')

      expect(container.querySelector('.chat-history-shell')).toBeInTheDocument()
      expect(hoverArea).toBeInTheDocument()

      if (hoverArea) {
        fireEvent.mouseEnter(hoverArea)
        expect(hoverArea).toHaveClass('left-0')

        fireEvent.mouseLeave(hoverArea)
        expect(hoverArea).toHaveClass('-left-62')
      }
    })

    it('renders a new theme when site configuration changes', () => {
      const { rerender } = render(<ChatWithHistory />)

      expect(screen.getByLabelText('chat theme')).toHaveTextContent('blue:false')

      vi.mocked(useChatWithHistory).mockReturnValue({
        ...defaultHookReturn,
        appData: {
          ...mockAppData,
          site: {
            ...mockAppData.site,
            chat_color_theme: '#654321',
            chat_color_theme_inverted: true,
          },
        },
      })
      rerender(<ChatWithHistory />)

      expect(screen.getByLabelText('chat theme')).toHaveTextContent('#654321:true')
    })

    it('falls back to the mobile loading shell when site metadata is unavailable', () => {
      vi.mocked(useBreakpoints).mockReturnValue(MediaType.mobile)
      vi.mocked(useChatWithHistory).mockReturnValue({
        ...defaultHookReturn,
        appData: null,
        appChatListDataLoading: true,
      })

      const { container } = render(<ChatWithHistory className="mobile-chat-shell" />)

      expect(useDocumentTitle).toHaveBeenCalledWith('Chat')
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(container.querySelector('.mobile-chat-shell')).toBeInTheDocument()
      expect(container.querySelector('.rounded-t-2xl')).toBeInTheDocument()
      expect(container.querySelector('.rounded-2xl')).not.toBeInTheDocument()
    })
  })
})
