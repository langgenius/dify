import type { ReactNode } from 'react'
import type { ChatConfig } from '../types'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/app/components/base/toast'
import {
  AppSourceType,
  fetchChatList,
  fetchConversations,
  generationConversationName,
} from '@/service/share'
import { shareQueryKeys } from '@/service/use-share'
import { CONVERSATION_ID_INFO } from '../constants'
import { useEmbeddedChatbot } from './hooks'

vi.mock('@/i18n-config/client', () => ({
  changeLanguage: vi.fn().mockResolvedValue(undefined),
}))

const mockStoreState: {
  appInfo: AppData | null
  appMeta: AppMeta | null
  appParams: ChatConfig | null
  embeddedConversationId: string | null
  embeddedUserId: string | null
} = {
  appInfo: null,
  appMeta: null,
  appParams: null,
  embeddedConversationId: null,
  embeddedUserId: null,
}

const useWebAppStoreMock = vi.fn((selector?: (state: typeof mockStoreState) => unknown) => {
  return selector ? selector(mockStoreState) : mockStoreState
})

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector?: (state: typeof mockStoreState) => unknown) => useWebAppStoreMock(selector),
}))

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils')
  return {
    ...actual,
    getProcessedInputsFromUrlParams: vi.fn().mockResolvedValue({}),
    getProcessedSystemVariablesFromUrlParams: vi.fn().mockResolvedValue({}),
    getProcessedUserVariablesFromUrlParams: vi.fn().mockResolvedValue({}),
  }
})

vi.mock('@/service/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/share')>()
  return {
    ...actual,
    fetchChatList: vi.fn(),
    fetchConversations: vi.fn(),
    generationConversationName: vi.fn(),
    fetchAppInfo: vi.fn(),
    fetchAppMeta: vi.fn(),
    fetchAppParams: vi.fn(),
    getAppAccessModeByAppCode: vi.fn(),
    updateFeedback: vi.fn(),
  }
})

const mockFetchConversations = vi.mocked(fetchConversations)
const mockFetchChatList = vi.mocked(fetchChatList)
const mockGenerationConversationName = vi.mocked(generationConversationName)

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}

const renderWithClient = <T,>(hook: () => T) => {
  const queryClient = createQueryClient()
  const wrapper = createWrapper(queryClient)
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  }
}

const createConversationItem = (overrides: Partial<ConversationItem> = {}): ConversationItem => ({
  id: 'conversation-1',
  name: 'Conversation 1',
  inputs: null,
  introduction: '',
  ...overrides,
})

const createConversationData = (overrides: Partial<AppConversationData> = {}): AppConversationData => ({
  data: [createConversationItem()],
  has_more: false,
  limit: 100,
  ...overrides,
})

// Scenario: useEmbeddedChatbot integrates share queries for conversations and chat list.
describe('useEmbeddedChatbot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem(CONVERSATION_ID_INFO)
    mockStoreState.appInfo = {
      app_id: 'app-1',
      custom_config: null,
      site: {
        title: 'Test App',
        default_language: 'en-US',
      },
    }
    mockStoreState.appMeta = {
      tool_icons: {},
    }
    mockStoreState.appParams = null
    mockStoreState.embeddedConversationId = 'conversation-1'
    mockStoreState.embeddedUserId = 'embedded-user-1'
  })

  afterEach(() => {
    localStorage.removeItem(CONVERSATION_ID_INFO)
  })

  // Scenario: share query results populate conversation lists and trigger chat list fetch.
  describe('Share queries', () => {
    it('should load pinned, unpinned, and chat list data from share queries', async () => {
      // Arrange
      const pinnedData = createConversationData({
        data: [createConversationItem({ id: 'pinned-1', name: 'Pinned' })],
      })
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      mockFetchConversations.mockImplementation(async (_isInstalledApp, _appId, _lastId, pinned) => {
        return pinned ? pinnedData : listData
      })
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      // Assert
      await waitFor(() => {
        expect(mockFetchConversations).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', undefined, true, 100)
      })
      await waitFor(() => {
        expect(mockFetchConversations).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', undefined, false, 100)
      })
      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledWith('conversation-1', AppSourceType.webApp, 'app-1')
      })
      expect(result.current.pinnedConversationList).toEqual(pinnedData.data)
      expect(result.current.conversationList).toEqual(listData.data)
    })
  })

  // Scenario: completion invalidates share caches and merges generated names.
  describe('New conversation completion', () => {
    it('should invalidate share conversations and apply generated name', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      const generatedConversation = createConversationItem({
        id: 'conversation-new',
        name: 'Generated',
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(generatedConversation)

      const { result, queryClient } = renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      // Act
      act(() => {
        result.current.handleNewConversationCompleted('conversation-new')
      })

      // Assert
      await waitFor(() => {
        expect(mockGenerationConversationName).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', 'conversation-new')
      })
      await waitFor(() => {
        expect(result.current.conversationList[0]).toEqual(generatedConversation)
      })
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: shareQueryKeys.conversations })
    })
  })

  // Scenario: chat list queries stop when reload key is cleared.
  describe('Chat list gating', () => {
    it('should not refetch chat list when newConversationId matches current conversation', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(createConversationItem({ id: 'conversation-1' }))

      const { result } = renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledTimes(1)
      })

      // Act
      act(() => {
        result.current.handleNewConversationCompleted('conversation-1')
      })

      // Assert
      await waitFor(() => {
        expect(result.current.chatShouldReloadKey).toBe('')
      })
      expect(mockFetchChatList).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: conversation id updates persist to localStorage.
  describe('Conversation id persistence', () => {
    it('should store new conversation id in localStorage after completion', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(createConversationItem({ id: 'conversation-new' }))

      const { result } = renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      // Act
      act(() => {
        result.current.handleNewConversationCompleted('conversation-new')
      })

      // Assert
      await waitFor(() => {
        const storedValue = localStorage.getItem(CONVERSATION_ID_INFO)
        const parsed = storedValue ? JSON.parse(storedValue) : {}
        const storedUserId = parsed['app-1']?.['embedded-user-1']
        const storedDefaultId = parsed['app-1']?.DEFAULT
        expect([storedUserId, storedDefaultId]).toContain('conversation-new')
      })
    })
  })
})
