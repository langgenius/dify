import type { ReactNode } from 'react'
import type { ChatConversationGeneralDetail, ChatConversationsResponse } from '@/models/log'
import type { App, AppIconType } from '@/types/app'
import { render, screen } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { APP_PAGE_LIMIT } from '@/config'
import { AppModeEnum } from '@/types/app'
import Logs from './index'

const mockUseChatConversations = vi.fn()
const mockUseCompletionConversations = vi.fn()
const mockUseAnnotationsCount = vi.fn()

const mockRouterPush = vi.fn()
const mockRouterReplace = vi.fn()

const mockAppStoreState = {
  setShowPromptLogModal: vi.fn(),
  setShowAgentLogModal: vi.fn(),
  setShowMessageLogModal: vi.fn(),
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  usePathname: () => '/apps/app-123/logs',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/service/use-log', () => ({
  useChatConversations: (args: unknown) => mockUseChatConversations(args),
  useCompletionConversations: (args: unknown) => mockUseCompletionConversations(args),
  useAnnotationsCount: () => mockUseAnnotationsCount(),
  useChatConversationDetail: () => ({ data: undefined }),
  useCompletionConversationDetail: () => ({ data: undefined }),
}))

vi.mock('@/service/log', () => ({
  fetchChatMessages: vi.fn(),
  updateLogMessageAnnotations: vi.fn(),
  updateLogMessageFeedbacks: vi.fn(),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: { timezone: 'UTC' },
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: typeof mockAppStoreState) => unknown) => selector(mockAppStoreState),
}))

const renderWithAdapter = (ui: ReactNode, searchParams = '') => {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      {ui}
    </NuqsTestingAdapter>,
  )
}

const createMockApp = (overrides: Partial<App> = {}): App => ({
  id: 'app-123',
  name: 'Test App',
  description: 'Test app description',
  author_name: 'Test Author',
  icon_type: 'emoji' as AppIconType,
  icon: ':icon:',
  icon_background: '#FFEAD5',
  icon_url: null,
  use_icon_as_answer_icon: false,
  mode: AppModeEnum.CHAT,
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
})

const createChatConversation = (overrides: Partial<ChatConversationGeneralDetail> = {}): ChatConversationGeneralDetail => ({
  id: 'conversation-1',
  status: 'normal',
  from_source: 'api',
  from_end_user_id: 'user-1',
  from_end_user_session_id: 'session-1',
  from_account_id: 'account-1',
  read_at: new Date(),
  created_at: 1700000000,
  updated_at: 1700000001,
  user_feedback_stats: { like: 0, dislike: 0 },
  admin_feedback_stats: { like: 0, dislike: 0 },
  model_config: {
    provider: 'openai',
    model_id: 'gpt-4',
    configs: { prompt_template: '' },
  },
  summary: 'Conversation summary',
  message_count: 1,
  annotated: false,
  ...overrides,
})

const createChatConversationsResponse = (overrides: Partial<ChatConversationsResponse> = {}): ChatConversationsResponse => ({
  data: [createChatConversation()],
  has_more: false,
  limit: APP_PAGE_LIMIT,
  total: 1,
  page: 1,
  ...overrides,
})

// Logs page: loading, empty, and data states.
describe('Logs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.innerWidth = 1024

    mockUseAnnotationsCount.mockReturnValue({
      data: { count: 0 },
      isLoading: false,
    })

    mockUseChatConversations.mockReturnValue({
      data: undefined,
      refetch: vi.fn(),
    })

    mockUseCompletionConversations.mockReturnValue({
      data: undefined,
      refetch: vi.fn(),
    })
  })

  // Loading behavior when no data yet.
  describe('Rendering', () => {
    it('should render loading state when conversations are undefined', () => {
      // Arrange
      const appDetail = createMockApp()

      // Act
      renderWithAdapter(<Logs appDetail={appDetail} />)

      // Assert
      expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('should render empty state when there are no conversations', () => {
      // Arrange
      mockUseChatConversations.mockReturnValue({
        data: createChatConversationsResponse({ data: [], total: 0 }),
        refetch: vi.fn(),
      })
      const appDetail = createMockApp()

      // Act
      renderWithAdapter(<Logs appDetail={appDetail} />)

      // Assert
      expect(screen.getByText('appLog.table.empty.element.title')).toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })
  })

  // Data rendering behavior.
  describe('Props', () => {
    it('should render list with pagination when conversations exist', () => {
      // Arrange
      mockUseChatConversations.mockReturnValue({
        data: createChatConversationsResponse({ total: APP_PAGE_LIMIT + 1 }),
        refetch: vi.fn(),
      })
      const appDetail = createMockApp()

      // Act
      renderWithAdapter(<Logs appDetail={appDetail} />, '?page=0&limit=0')

      // Assert
      expect(screen.getByText('appLog.table.header.summary')).toBeInTheDocument()
      expect(screen.getByText('25')).toBeInTheDocument()

      const firstCallArgs = mockUseChatConversations.mock.calls[0]?.[0]
      expect(firstCallArgs.params.page).toBe(1)
      expect(firstCallArgs.params.limit).toBe(APP_PAGE_LIMIT)
    })
  })
})
