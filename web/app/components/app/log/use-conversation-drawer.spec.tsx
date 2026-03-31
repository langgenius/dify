import type { ChatConversationGeneralDetail, ChatConversationsResponse } from '@/models/log'
import type { App, AppIconType, AppModeEnum } from '@/types/app'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useConversationDrawer } from './use-conversation-drawer'

const mockPush = vi.fn()
const mockReplace = vi.fn()
const mockSetShowPromptLogModal = vi.fn()
const mockSetShowAgentLogModal = vi.fn()
const mockSetShowMessageLogModal = vi.fn()

let mockSearchParams = new URLSearchParams()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
  usePathname: () => '/apps/test-app/logs',
  useSearchParams: () => mockSearchParams,
}))

vi.mock('@/hooks/use-breakpoints', () => ({
  __esModule: true,
  default: () => 'pc',
  MediaType: {
    mobile: 'mobile',
    pc: 'pc',
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: {
    setShowPromptLogModal: typeof mockSetShowPromptLogModal
    setShowAgentLogModal: typeof mockSetShowAgentLogModal
    setShowMessageLogModal: typeof mockSetShowMessageLogModal
  }) => unknown) => selector({
    setShowPromptLogModal: mockSetShowPromptLogModal,
    setShowAgentLogModal: mockSetShowAgentLogModal,
    setShowMessageLogModal: mockSetShowMessageLogModal,
  }),
}))

const createMockApp = (overrides: Partial<App> = {}) => ({
  id: 'test-app-id',
  name: 'Test App',
  description: 'Test app description',
  author_name: 'Test Author',
  icon_type: 'emoji' as AppIconType,
  icon: '🚀',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: 'chat' as AppModeEnum,
  runtime_type: 'classic' as const,
  enable_site: true,
  enable_api: true,
  api_rpm: 60,
  api_rph: 3600,
  is_demo: false,
  model_config: {} as App['model_config'],
  app_model_config: {} as App['app_model_config'],
  created_at: Date.now(),
  updated_at: Date.now(),
  site: {
    access_token: 'token',
    app_base_url: 'https://example.com',
  } as App['site'],
  api_base_url: 'https://api.example.com',
  tags: [],
  access_mode: 'public_access' as App['access_mode'],
  ...overrides,
}) satisfies App

const createChatLog = (overrides: Partial<ChatConversationGeneralDetail> = {}): ChatConversationGeneralDetail => ({
  id: 'chat-conversation-1',
  status: 'normal',
  from_source: 'console',
  from_end_user_id: 'end-user-1',
  from_end_user_session_id: 'session-1',
  from_account_id: 'account-1',
  read_at: new Date(),
  created_at: 100,
  updated_at: 200,
  user_feedback_stats: { like: 1, dislike: 0 },
  admin_feedback_stats: { like: 0, dislike: 1 },
  model_config: {
    provider: 'openai',
    model_id: 'gpt-4',
    configs: {
      prompt_template: 'Prompt',
    },
  },
  summary: 'Chat summary',
  message_count: 2,
  annotated: false,
  ...overrides,
})

const createLogs = (log: ChatConversationGeneralDetail): ChatConversationsResponse => ({
  data: [log],
  has_more: false,
  limit: 20,
  total: 1,
  page: 1,
})

describe('useConversationDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSearchParams = new URLSearchParams()
  })

  it('should reopen the active conversation without pushing a new url', async () => {
    mockSearchParams = new URLSearchParams('conversation_id=chat-conversation-1')
    const log = createChatLog()

    const { result } = renderHook(() => useConversationDrawer({
      appDetail: createMockApp(),
      logs: createLogs(log),
      onRefresh: vi.fn(),
    }))

    await waitFor(() => {
      expect(result.current.showDrawer).toBe(true)
      expect(result.current.currentConversation?.id).toBe(log.id)
    })

    act(() => {
      result.current.onCloseDrawer()
    })

    expect(result.current.showDrawer).toBe(false)

    act(() => {
      result.current.handleRowClick(log)
    })

    expect(result.current.showDrawer).toBe(true)
    expect(result.current.currentConversation?.id).toBe(log.id)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('should clear drawer state when the conversation id disappears from the url', async () => {
    mockSearchParams = new URLSearchParams('conversation_id=chat-conversation-1')
    const log = createChatLog()

    const { result, rerender } = renderHook(() => useConversationDrawer({
      appDetail: createMockApp(),
      logs: createLogs(log),
      onRefresh: vi.fn(),
    }))

    await waitFor(() => {
      expect(result.current.showDrawer).toBe(true)
      expect(result.current.currentConversation?.id).toBe(log.id)
    })

    mockSearchParams = new URLSearchParams()
    rerender()

    await waitFor(() => {
      expect(result.current.showDrawer).toBe(false)
      expect(result.current.currentConversation).toBeUndefined()
    })
  })

  it('should keep a pending conversation active until the url catches up', async () => {
    const onRefresh = vi.fn()
    const log = createChatLog()

    const { result, rerender } = renderHook(() => useConversationDrawer({
      appDetail: createMockApp(),
      logs: undefined,
      onRefresh,
    }))

    act(() => {
      result.current.handleRowClick(log)
    })

    expect(result.current.showDrawer).toBe(true)
    expect(result.current.activeConversationId).toBe(log.id)
    expect(result.current.currentConversation?.id).toBe(log.id)
    expect(mockPush).toHaveBeenCalledWith('/apps/test-app/logs?conversation_id=chat-conversation-1', { scroll: false })

    mockSearchParams = new URLSearchParams('conversation_id=chat-conversation-1')
    rerender()

    await waitFor(() => {
      expect(result.current.currentConversation?.id).toBe(log.id)
    })

    expect(result.current.activeConversationId).toBe(log.id)
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
