import type { ReactNode } from 'react'
import type { AppConversationData, ConversationItem } from '@/models/share'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import {
  AppSourceType,
  fetchChatList,
  fetchConversations,
  generationConversationName,
} from './share'
import {
  shareQueryKeys,
  useInvalidateShareConversations,
  useShareChatList,
  useShareConversationName,
  useShareConversations,
} from './use-share'

vi.mock('./share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./share')>()
  return {
    ...actual,
    fetchChatList: vi.fn(),
    fetchConversations: vi.fn(),
    generationConversationName: vi.fn(),
    fetchAppInfo: vi.fn(),
    fetchAppMeta: vi.fn(),
    fetchAppParams: vi.fn(),
    getAppAccessModeByAppCode: vi.fn(),
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
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const renderShareHook = <T,>(hook: () => T) => {
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
  introduction: 'Intro',
  ...overrides,
})

const createConversationData = (overrides: Partial<AppConversationData> = {}): AppConversationData => ({
  data: [createConversationItem()],
  has_more: false,
  limit: 20,
  ...overrides,
})

// Scenario: share conversation list queries behave consistently with params and enablement.
describe('useShareConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch conversations when enabled for non-installed apps', async () => {
    // Arrange
    const params = {
      isInstalledApp: false,
      appId: undefined,
      pinned: true,
      limit: 50,
      appSourceType: AppSourceType.webApp,
    }
    const response = createConversationData()
    mockFetchConversations.mockResolvedValueOnce(response)

    // Act
    const { result, queryClient } = renderShareHook(() => useShareConversations(params))

    // Assert
    await waitFor(() => {
      expect(mockFetchConversations).toHaveBeenCalledWith(AppSourceType.webApp, undefined, undefined, true, 50)
    })
    await waitFor(() => {
      expect(result.current.data).toEqual(response)
    })
    expect(queryClient.getQueryCache().find({ queryKey: shareQueryKeys.conversationList(params) })).toBeDefined()
  })

  it('should not fetch conversations when installed app lacks appId', async () => {
    // Arrange
    const params = {
      isInstalledApp: true,
      appId: undefined,
      appSourceType: AppSourceType.installedApp,
    }

    // Act
    const { result } = renderShareHook(() => useShareConversations(params))

    // Assert
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle')
    })
    expect(mockFetchConversations).not.toHaveBeenCalled()
  })
})

// Scenario: chat list queries respect conversation ID and app installation rules.
describe('useShareChatList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch chat list when conversationId is provided', async () => {
    // Arrange
    const params = {
      conversationId: 'conversation-1',
      isInstalledApp: true,
      appId: 'app-1',
      appSourceType: AppSourceType.installedApp,
    }
    const response = { data: [] }
    mockFetchChatList.mockResolvedValueOnce(response)

    // Act
    const { result } = renderShareHook(() => useShareChatList(params))

    // Assert
    await waitFor(() => {
      expect(mockFetchChatList).toHaveBeenCalledWith('conversation-1', AppSourceType.installedApp, 'app-1')
    })
    await waitFor(() => {
      expect(result.current.data).toEqual(response)
    })
  })

  it('should not fetch chat list when conversationId is empty', async () => {
    // Arrange
    const params = {
      conversationId: '',
      isInstalledApp: false,
      appId: undefined,
      appSourceType: AppSourceType.webApp,
    }

    // Act
    const { result } = renderShareHook(() => useShareChatList(params))

    // Assert
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle')
    })
    expect(mockFetchChatList).not.toHaveBeenCalled()
  })

  it('should always consider data stale to ensure fresh data on conversation switch (GitHub #30378)', async () => {
    // This test verifies that chat list data is always considered stale (staleTime: 0)
    // which ensures fresh data is fetched when switching back to a conversation.
    // Without this, users would see outdated messages until double-switching.
    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)
    const params = {
      conversationId: 'conversation-1',
      isInstalledApp: false,
      appId: undefined,
      appSourceType: AppSourceType.webApp,
    }
    const initialResponse = { data: [{ id: '1', content: 'initial' }] }
    const updatedResponse = { data: [{ id: '1', content: 'initial' }, { id: '2', content: 'new message' }] }

    // First fetch
    mockFetchChatList.mockResolvedValueOnce(initialResponse)
    const { result, unmount } = renderHook(() => useShareChatList(params), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toEqual(initialResponse)
    })
    expect(mockFetchChatList).toHaveBeenCalledTimes(1)

    // Unmount (simulates switching away from conversation)
    unmount()

    // Remount with same params (simulates switching back)
    // With staleTime: 0, this should trigger a background refetch
    mockFetchChatList.mockResolvedValueOnce(updatedResponse)
    const { result: result2 } = renderHook(() => useShareChatList(params), { wrapper })

    // Should immediately return cached data
    expect(result2.current.data).toEqual(initialResponse)

    // Should trigger background refetch due to staleTime: 0
    await waitFor(() => {
      expect(mockFetchChatList).toHaveBeenCalledTimes(2)
    })

    // Should update with fresh data
    await waitFor(() => {
      expect(result2.current.data).toEqual(updatedResponse)
    })
  })
})

// Scenario: conversation name queries follow enabled flags and installation constraints.
describe('useShareConversationName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should fetch conversation name when enabled and conversationId exists', async () => {
    // Arrange
    const params = {
      conversationId: 'conversation-2',
      isInstalledApp: false,
      appId: undefined,
      appSourceType: AppSourceType.webApp,
    }
    const response = createConversationItem({ id: 'conversation-2', name: 'Generated' })
    mockGenerationConversationName.mockResolvedValueOnce(response)

    // Act
    const { result } = renderShareHook(() => useShareConversationName(params))

    // Assert
    await waitFor(() => {
      expect(mockGenerationConversationName).toHaveBeenCalledWith(AppSourceType.webApp, undefined, 'conversation-2')
    })
    await waitFor(() => {
      expect(result.current.data).toEqual(response)
    })
  })

  it('should not fetch conversation name when disabled via options', async () => {
    // Arrange
    const params = {
      conversationId: 'conversation-3',
      isInstalledApp: false,
      appId: undefined,
      appSourceType: AppSourceType.webApp,
    }

    // Act
    const { result } = renderShareHook(() => useShareConversationName(params, { enabled: false }))

    // Assert
    await waitFor(() => {
      expect(result.current.fetchStatus).toBe('idle')
    })
    expect(mockGenerationConversationName).not.toHaveBeenCalled()
  })
})

// Scenario: invalidation helper clears share conversation caches.
describe('useInvalidateShareConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should invalidate share conversations query key when invoked', () => {
    // Arrange
    const { result, queryClient } = renderShareHook(() => useInvalidateShareConversations())
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    // Act
    act(() => {
      result.current()
    })

    // Assert
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: shareQueryKeys.conversations })
  })
})
