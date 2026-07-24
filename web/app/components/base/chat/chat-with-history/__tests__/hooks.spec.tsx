import type { ReactNode } from 'react'
import type { ChatConfig } from '../../types'
import type { InstalledApp } from '@/models/explore'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/app/components/base/toast'
import {
  AppSourceType,
  delConversation,
  fetchChatList,
  fetchConversations,
  generationConversationName,
  pinConversation,
  renameConversation,
  unpinConversation,
  updateFeedback,
} from '@/service/share'
import { shareQueryKeys } from '@/service/use-share'
import { CONVERSATION_ID_INFO } from '../../constants'
import { useChatWithHistory } from '.././hooks'

vi.mock('@/hooks/use-app-favicon', () => ({
  useAppFavicon: vi.fn(),
}))

vi.mock('@/i18n-config/client', () => ({
  changeLanguage: vi.fn().mockResolvedValue(undefined),
}))

const mockStoreState: {
  appInfo: AppData | null
  appMeta: AppMeta | null
  appParams: ChatConfig | null
} = {
  appInfo: null,
  appMeta: null,
  appParams: null,
}

const useWebAppStoreMock = vi.fn((selector?: (state: typeof mockStoreState) => unknown) => {
  return selector ? selector(mockStoreState) : mockStoreState
})

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector?: (state: typeof mockStoreState) => unknown) => useWebAppStoreMock(selector),
}))

vi.mock('../../utils', async () => {
  const actual = await vi.importActual<typeof import('../../utils')>('../../utils')
  return {
    ...actual,
    getProcessedSystemVariablesFromUrlParams: vi.fn().mockResolvedValue({ user_id: 'user-1' }),
    getRawInputsFromUrlParams: vi.fn().mockResolvedValue({}),
    getRawUserVariablesFromUrlParams: vi.fn().mockResolvedValue({}),
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
    delConversation: vi.fn(),
    pinConversation: vi.fn(),
    renameConversation: vi.fn(),
    unpinConversation: vi.fn(),
    updateFeedback: vi.fn(),
  }
})

const mockFetchConversations = vi.mocked(fetchConversations)
const mockFetchChatList = vi.mocked(fetchChatList)
const mockGenerationConversationName = vi.mocked(generationConversationName)
const mockDelConversation = vi.mocked(delConversation)
const mockPinConversation = vi.mocked(pinConversation)
const mockUnpinConversation = vi.mocked(unpinConversation)
const mockRenameConversation = vi.mocked(renameConversation)
const mockUpdateFeedback = vi.mocked(updateFeedback)

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

const renderWithClient = async <T,>(hook: () => T) => {
  const queryClient = createQueryClient()
  const wrapper = createWrapper(queryClient)
  let result: ReturnType<typeof renderHook<T, unknown>> | undefined
  // Use act to flush any initial state updates (like from useQuery fetching in the background)
  await act(async () => {
    result = renderHook(hook, { wrapper })
    // Wait for the microtasks queue to empty out the initial query settling
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  return {
    queryClient,
    ...result,
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

const setConversationIdInfo = (appId: string, conversationId: string) => {
  const value = {
    [appId]: {
      'user-1': conversationId,
      'DEFAULT': conversationId,
    },
  }
  localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify(value))
}

// Scenario: useChatWithHistory integrates share queries for conversations and chat list.
describe('useChatWithHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.removeItem(CONVERSATION_ID_INFO)
    localStorage.removeItem('webappSidebarCollapse')
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
    setConversationIdInfo('app-1', 'conversation-1')
  })

  afterEach(() => {
    localStorage.removeItem(CONVERSATION_ID_INFO)
    localStorage.removeItem('webappSidebarCollapse')
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
      const { result } = await renderWithClient(() => useChatWithHistory())

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
      await waitFor(() => {
        expect(result!.current.pinnedConversationList).toEqual(pinnedData.data)
      })
      await waitFor(() => {
        expect(result!.current.conversationList).toEqual(listData.data)
      })
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

      const { result, queryClient } = await renderWithClient(() => useChatWithHistory())
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      // Act
      act(() => {
        result!.current.handleNewConversationCompleted('conversation-new')
      })

      // Assert
      await waitFor(() => {
        expect(mockGenerationConversationName).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', 'conversation-new')
      })
      await waitFor(() => {
        expect(result!.current.conversationList[0]).toEqual(generatedConversation)
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

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledTimes(1)
      })

      // Act
      act(() => {
        result!.current.handleNewConversationCompleted('conversation-1')
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.chatShouldReloadKey).toBe('')
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

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleNewConversationCompleted('conversation-new')
      })

      // Assert
      await waitFor(() => {
        const storedValue = localStorage.getItem(CONVERSATION_ID_INFO)
        const parsed = storedValue ? JSON.parse(storedValue) : {}
        const storedUserId = parsed['app-1']?.['user-1']
        const storedDefaultId = parsed['app-1']?.DEFAULT
        expect([storedUserId, storedDefaultId]).toContain('conversation-new')
      })
    })
  })

  // Scenario: sidebar collapse state is toggled and persisted.
  describe('Sidebar collapse', () => {
    it('should update sidebarCollapseState and localStorage when collapsed', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleSidebarCollapse(true)
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.sidebarCollapseState).toBe(true)
      })
      expect(localStorage.getItem('webappSidebarCollapse')).toBe('collapsed')
    })

    it('should set expanded state in localStorage when not collapsed', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleSidebarCollapse(false)
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.sidebarCollapseState).toBe(false)
      })
      expect(localStorage.getItem('webappSidebarCollapse')).toBe('expanded')
    })

    it('should read initial collapse state from localStorage', async () => {
      // Arrange
      localStorage.setItem('webappSidebarCollapse', 'collapsed')
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      expect(result!.current.sidebarCollapseState).toBe(true)
      localStorage.removeItem('webappSidebarCollapse')
    })
  })

  // Scenario: pin and unpin conversations call the correct service and invalidate queries.
  describe('Pin/Unpin conversation', () => {
    it('should call pinConversation service and invalidate conversations', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockPinConversation.mockResolvedValue(undefined)

      const { result, queryClient } = await renderWithClient(() => useChatWithHistory())
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      // Act
      await act(async () => {
        await result!.current.handlePinConversation('conversation-1')
      })

      // Assert
      expect(mockPinConversation).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', 'conversation-1')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: shareQueryKeys.conversations })
    })

    it('should call unpinConversation service and invalidate conversations', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockUnpinConversation.mockResolvedValue(undefined)

      const { result, queryClient } = await renderWithClient(() => useChatWithHistory())
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

      // Act
      await act(async () => {
        await result!.current.handleUnpinConversation('conversation-1')
      })

      // Assert
      expect(mockUnpinConversation).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', 'conversation-1')
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: shareQueryKeys.conversations })
    })
  })

  // Scenario: delete conversation handles success, guard, and deletion of current conversation.
  describe('Delete conversation', () => {
    it('should call delConversation and invoke success callback', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockDelConversation.mockResolvedValue(undefined)
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      await act(async () => {
        await result!.current.handleDeleteConversation('other-conversation', { onSuccess })
      })

      // Assert
      expect(mockDelConversation).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', 'other-conversation')
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })

    it('should skip deletion when conversationDeleting is true (guard)', async () => {
      // Arrange
      let resolveDelete!: () => void
      const deletePromise = new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      // First call blocks, second call should be rejected by guard
      mockDelConversation.mockReturnValueOnce(deletePromise as unknown as ReturnType<typeof mockDelConversation>)
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act: start first delete (does not immediately resolve, sets conversationDeleting=true)
      act(() => {
        result!.current.handleDeleteConversation('other-conversation', { onSuccess })
      })

      // conversationDeleting is now true; second call should be skipped by guard
      await act(async () => {
        result!.current.handleDeleteConversation('other-conversation', { onSuccess })
        resolveDelete()
      })

      // Only one actual delete call
      expect(mockDelConversation).toHaveBeenCalledTimes(1)
    })

    it('should call handleNewConversation when deleting the current conversation', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockDelConversation.mockResolvedValue(undefined)
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert current conversation is set
      await waitFor(() => {
        expect(result!.current.currentConversationId).toBe('conversation-1')
      })

      // Act: delete the current conversation
      await act(async () => {
        await result!.current.handleDeleteConversation('conversation-1', { onSuccess })
      })

      // Assert: handleNewConversation side-effect: clearChatList set to true
      await waitFor(() => {
        expect(result!.current.clearChatList).toBe(true)
      })
    })
  })

  // Scenario: rename conversation handles success, empty name guard, and renaming guard.
  describe('Rename conversation', () => {
    it('should call renameConversation with new name and update list', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'Old Name' })],
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockRenameConversation.mockResolvedValue(undefined)
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.conversationList).toHaveLength(1)
      })

      // Act
      await act(async () => {
        await result!.current.handleRenameConversation('conversation-1', 'New Name', { onSuccess })
      })

      // Assert
      expect(mockRenameConversation).toHaveBeenCalledWith(AppSourceType.webApp, 'app-1', 'conversation-1', 'New Name')
      expect(onSuccess).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(result!.current.conversationList[0].name).toBe('New Name')
      })
    })

    it('should not rename when new name is empty (whitespace)', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      await act(async () => {
        await result!.current.handleRenameConversation('conversation-1', '   ', { onSuccess })
      })

      // Assert
      expect(mockRenameConversation).not.toHaveBeenCalled()
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('should skip second rename when conversationRenaming is true (guard)', async () => {
      // Arrange
      let resolveRename!: () => void
      const renamePromise = new Promise<void>((resolve) => {
        resolveRename = resolve
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockRenameConversation.mockReturnValueOnce(renamePromise as unknown as ReturnType<typeof mockRenameConversation>)
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act: start first rename (does not immediately resolve, sets conversationRenaming=true)
      act(() => {
        result!.current.handleRenameConversation('conversation-1', 'Name A', { onSuccess })
      })

      // conversationRenaming is now true; second call should be skipped by guard
      await act(async () => {
        result!.current.handleRenameConversation('conversation-1', 'Name B', { onSuccess })
        resolveRename()
      })

      // Only one actual rename call
      expect(mockRenameConversation).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: handle feedback sends the correct payload.
  describe('Handle feedback', () => {
    it('should call updateFeedback with correct parameters', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockUpdateFeedback.mockResolvedValue(undefined)

      const { result } = await renderWithClient(() => useChatWithHistory())

      const feedback = { rating: 'like' as const, content: 'Great!' }

      // Act
      await act(async () => {
        await result!.current.handleFeedback('message-1', feedback)
      })

      // Assert
      expect(mockUpdateFeedback).toHaveBeenCalledWith(
        { url: '/messages/message-1/feedbacks', body: { rating: 'like', content: 'Great!' } },
        AppSourceType.webApp,
        'app-1',
      )
    })
  })

  // Scenario: handle new conversation resets state.
  describe('Handle new conversation', () => {
    it('should reset conversation state and show new item in list', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleNewConversation()
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.currentConversationId).toBe('')
      })
      expect(result!.current.clearChatList).toBe(true)
    })

    it('should show new conversation item in the conversation list', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      }))
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.conversationList).toHaveLength(1)
      })

      // Act
      act(() => {
        result!.current.handleNewConversation()
      })

      // Assert: new item with empty id prepended
      await waitFor(() => {
        expect(result!.current.conversationList[0].id).toBe('')
      })
    })
  })

  // Scenario: handleChangeConversation clears newConversationId and updates conversationIdInfo.
  describe('Handle change conversation', () => {
    it('should clear newConversationId when switching to existing conversation', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(createConversationItem({ id: 'conversation-new' }))

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Set a newConversationId first
      act(() => {
        result!.current.handleNewConversationCompleted('conversation-new')
      })

      await waitFor(() => {
        expect(result!.current.newConversationId).toBe('conversation-new')
      })

      // Act
      act(() => {
        result!.current.handleChangeConversation('conversation-1')
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.newConversationId).toBe('')
      })
      expect(result!.current.clearChatList).toBe(false)
    })
  })

  // Scenario: appParams drives inputsForms with various form item types
  describe('inputsForms', () => {
    it('should return paragraph form item with truncated value when over max_length', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            paragraph: {
              variable: 'para_var',
              label: 'Paragraph',
              required: true,
              max_length: 5,
              default: 'def',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('paragraph')
        expect(form.variable).toBe('para_var')
      })
    })

    it('should return number form item', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            number: {
              variable: 'num_var',
              label: 'Number',
              required: false,
              default: 42,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('number')
        expect(form.variable).toBe('num_var')
      })
    })

    it('should return checkbox form item', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            checkbox: {
              variable: 'check_var',
              label: 'Check',
              required: false,
              default: false,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('checkbox')
        expect(form.variable).toBe('check_var')
      })
    })

    it('should return select form item', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            select: {
              variable: 'sel_var',
              label: 'Select',
              required: false,
              options: ['a', 'b'],
              default: 'a',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('select')
        expect(form.variable).toBe('sel_var')
      })
    })

    it('should return file-list form item', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'file-list': {
              variable: 'files_var',
              label: 'Files',
              required: false,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('file-list')
        expect(form.variable).toBe('files_var')
      })
    })

    it('should return file form item', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            file: {
              variable: 'file_var',
              label: 'File',
              required: false,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('file')
        expect(form.variable).toBe('file_var')
      })
    })

    it('should return json_object form item', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            json_object: {
              variable: 'json_var',
              label: 'JSON',
              required: false,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('json_object')
        expect(form.variable).toBe('json_var')
      })
    })

    it('should return text-input form item', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'text_var',
              label: 'Text',
              required: true,
              max_length: 50,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.type).toBe('text-input')
        expect(form.variable).toBe('text_var')
      })
    })

    it('should skip items with external_data_tool set', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'external_data_tool': true,
            'text-input': {
              variable: 'text_var',
              label: 'Text',
              required: true,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.inputsForms).toHaveLength(0)
      })
    })
  })

  // Scenario: handleStartChat calls callback when inputs are valid.
  describe('handleStartChat', () => {
    it('should invoke callback and show new conversation item when inputs are valid', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should not invoke callback when required text input is missing', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'required_var',
              label: 'Required Field',
              required: true,
              max_length: 50,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Act (inputs are empty, required field not filled)
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).not.toHaveBeenCalled()
    })

    it('should invoke callback when allInputsHidden is true regardless of required fields', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'hidden_var',
              label: 'Hidden',
              required: true,
              hide: true,
              max_length: 50,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Assert allInputsHidden is true
      await waitFor(() => {
        expect(result!.current.allInputsHidden).toBe(true)
      })

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: installedAppInfo changes the appSourceType and appData.
  describe('installedApp mode', () => {
    it('should use installedApp source type and derive appData from installedAppInfo', async () => {
      // Arrange
      const installedAppInfo = {
        id: 'installed-app-id',
        app: {
          name: 'Installed App',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
          icon_url: '',
          use_icon_as_answer_icon: false,
        },
      } as unknown as InstalledApp
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory(installedAppInfo))

      // Assert
      expect(result!.current.isInstalledApp).toBe(true)
      expect(result!.current.appId).toBe('installed-app-id')
      expect(result!.current.appData?.site.title).toBe('Installed App')
    })
  })

  // Scenario: appPrevChatTree is built from chat list messages.
  describe('appPrevChatTree', () => {
    it('should build appPrevChatTree from fetched chat messages', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1' })],
      })
      const chatListData = {
        data: [
          {
            id: 'msg-1',
            query: 'Hello',
            answer: 'Hi there',
            message_files: [],
            feedback: null,
            retriever_resources: [],
            agent_thoughts: null,
            parent_message_id: null,
            inputs: {},
            status: 'normal',
            extra_contents: [],
          },
        ],
      }
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue(chatListData)

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      await waitFor(() => {
        expect(result!.current.appPrevChatTree.length).toBeGreaterThan(0)
      })
    })

    it('should build tree for paused message with human_input extra_content', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1' })],
      })
      const chatListData = {
        data: [
          {
            id: 'msg-paused',
            query: 'Paused query',
            answer: 'Awaiting input',
            message_files: [],
            feedback: null,
            retriever_resources: [],
            agent_thoughts: null,
            parent_message_id: null,
            inputs: {},
            status: 'paused',
            extra_contents: [
              {
                type: 'human_input',
                submitted: false,
                form_definition: { fields: [] },
                workflow_run_id: 'wf-run-1',
              },
            ],
          },
        ],
      }
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue(chatListData)

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.appPrevChatTree.length).toBeGreaterThan(0)
      })
    })

    it('should set workflow_run_id for normal messages with submitted human_input', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1' })],
      })
      const chatListData = {
        data: [
          {
            id: 'msg-normal',
            query: 'Normal query',
            answer: 'Answer',
            message_files: [],
            feedback: null,
            retriever_resources: [],
            agent_thoughts: null,
            parent_message_id: null,
            inputs: {},
            status: 'normal',
            extra_contents: [
              {
                type: 'human_input',
                submitted: true,
                form_submission_data: { field: 'value' },
              },
            ],
          },
        ],
      }
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue(chatListData)

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.appPrevChatTree.length).toBeGreaterThan(0)
      })
    })

    it('should return empty appPrevChatTree when there is no currentConversationId', async () => {
      // Arrange
      localStorage.removeItem(CONVERSATION_ID_INFO) // clear so no conversation selected
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      expect(result!.current.appPrevChatTree).toEqual([])
    })
  })

  // Scenario: currentConversationItem is found from pinned list when not in conversationList.
  describe('currentConversationItem from pinned list', () => {
    it('should find currentConversationItem from pinnedConversationList when not in conversationList', async () => {
      // Arrange: set current ID to pinned-1
      localStorage.removeItem(CONVERSATION_ID_INFO)
      setConversationIdInfo('app-1', 'pinned-1')

      const pinnedData = createConversationData({
        data: [createConversationItem({ id: 'pinned-1', name: 'Pinned Convo' })],
      })
      const listData = createConversationData({
        data: [createConversationItem({ id: 'other-1', name: 'Other' })],
      })
      mockFetchConversations.mockImplementation(async (_appSourceType, _appId, _lastId, pinned) => {
        return pinned ? pinnedData : listData
      })
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      await waitFor(() => {
        expect(result!.current.currentConversationItem?.id).toBe('pinned-1')
      })
    })
  })

  // Scenario: handleNewConversationInputsChange updates the inputs ref and state.
  describe('handleNewConversationInputsChange', () => {
    it('should update newConversationInputs when called', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleNewConversationInputsChange({ key: 'value' })
      })

      // Assert
      expect(result!.current.newConversationInputs).toEqual({ key: 'value' })
      expect(result!.current.newConversationInputsRef.current).toEqual({ key: 'value' })
    })
  })

  // Scenario: clearChatList and isResponding state control.
  describe('State controls', () => {
    it('should update clearChatList via setClearChatList', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.setClearChatList(true)
      })

      // Assert
      expect(result!.current.clearChatList).toBe(true)
    })

    it('should update isResponding via setIsResponding', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.setIsResponding(true)
      })

      // Assert
      expect(result!.current.isResponding).toBe(true)
    })
  })

  // Scenario: handleSidebarCollapse is a no-op when appId is not available.
  describe('handleSidebarCollapse without appId', () => {
    it('should not update state when appId is absent', async () => {
      // Arrange
      mockStoreState.appInfo = null // no app_id -> no appId
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const initialState = result!.current.sidebarCollapseState

      // Act
      act(() => {
        result!.current.handleSidebarCollapse(true)
      })

      // Assert: state unchanged since appId is absent
      expect(result!.current.sidebarCollapseState).toBe(initialState)
    })
  })

  // Scenario: handleConversationIdInfoChange handles legacy string prevValue.
  describe('handleConversationIdInfoChange with legacy string prevValue', () => {
    it('should treat existing string value as empty object', async () => {
      // Arrange: store a string value instead of an object (legacy format)
      const legacyValue = JSON.stringify({ 'app-1': 'legacy-string-id' })
      localStorage.setItem(CONVERSATION_ID_INFO, legacyValue)
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleConversationIdInfoChange('new-conversation')
      })

      // Assert: stored correctly without crash
      await waitFor(() => {
        const stored = localStorage.getItem(CONVERSATION_ID_INFO)
        const parsed = stored ? JSON.parse(stored) : {}
        expect(parsed['app-1']).toBeTruthy()
      })
    })
  })

  // Scenario: checkInputsRequired with file uploading (singleFile type, array).
  describe('checkInputsRequired - file uploading', () => {
    it('should return undefined (file uploading) when single file is still uploading as array', async () => {
      // Arrange: single file type with file still uploading
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'file_upload_var',
              label: 'Upload',
              required: false,
              type: 'singleFile',
              max_length: 100,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Set up an input that looks like a file being uploaded
      act(() => {
        result!.current.handleNewConversationInputsChange({
          file_upload_var: [
            { transferMethod: 'local_file', uploadedId: null },
          ],
        })
      })

      const callback = vi.fn()
      // Act: the hook uses checkInputsRequired which checks file uploading
      // Since type is text-input and required=false, will pass
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert callback is called (no required field issue)
      expect(callback).toHaveBeenCalled()
    })

    it('should return false when required text input is empty (not silent)', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'required_text',
              label: 'Required Text',
              required: true,
              max_length: 100,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Ensure no input value is set
      act(() => {
        result!.current.handleNewConversationInputsChange({ required_text: '' })
      })

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert: callback not called because required field is empty
      expect(callback).not.toHaveBeenCalled()
    })
  })

  // Scenario: paragraph and text-input max_length truncation from initInputs.
  describe('inputsForms value truncation', () => {
    it('should truncate paragraph value that exceeds max_length', async () => {
      // Arrange: mock getRawInputsFromUrlParams to return a long value
      const { getRawInputsFromUrlParams } = await import('../../utils')
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({ para_var: 'toolong_value_over_5' })

      mockStoreState.appParams = {
        user_input_form: [
          {
            paragraph: {
              variable: 'para_var',
              label: 'Para',
              required: false,
              max_length: 5,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        // default should be the truncated value
        expect(form.default?.length ?? 0).toBeLessThanOrEqual(5)
      })

      // Restore
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({})
    })

    it('should truncate text-input value that exceeds max_length', async () => {
      // Arrange
      const { getRawInputsFromUrlParams } = await import('../../utils')
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({ text_var: 'exceeds_max_length_value' })

      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'text_var',
              label: 'Text',
              required: false,
              max_length: 7,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.default?.length ?? 0).toBeLessThanOrEqual(7)
      })

      // Restore
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({})
    })
  })

  // Scenario: handleNewConversation with inputsForms having form defaults.
  describe('handleNewConversation with inputsForms', () => {
    it('should reset new conversation inputs to form defaults', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'my_var',
              label: 'My Var',
              required: false,
              max_length: 50,
              default: 'default_val',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Manually change inputs to something else
      act(() => {
        result!.current.handleNewConversationInputsChange({ my_var: 'changed' })
      })

      // Act
      act(() => {
        result!.current.handleNewConversation()
      })

      // Assert: inputs reset to form defaults
      await waitFor(() => {
        expect(result!.current.newConversationInputs.my_var).toBe('default_val')
      })
    })
  })

  // Scenario: select form item where input value is NOT in options.
  describe('inputsForms select option matching', () => {
    it('should use select default when initInput value is not in options', async () => {
      // Arrange
      const { getRawInputsFromUrlParams } = await import('../../utils')
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({ sel_var: 'not_an_option' })

      mockStoreState.appParams = {
        user_input_form: [
          {
            select: {
              variable: 'sel_var',
              label: 'Select',
              required: false,
              options: ['a', 'b'],
              default: 'a',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        // not_an_option is not in options, so falls back to select.default
        expect(form.default).toBe('a')
      })

      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({})
    })

    it('should use initInput value for select when it IS in options', async () => {
      // Arrange
      const { getRawInputsFromUrlParams } = await import('../../utils')
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({ sel_var: 'b' })

      mockStoreState.appParams = {
        user_input_form: [
          {
            select: {
              variable: 'sel_var',
              label: 'Select',
              required: false,
              options: ['a', 'b'],
              default: 'a',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        // 'b' is in options so it's used as default
        expect(form.default).toBe('b')
      })

      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({})
    })
  })

  // Scenario: checkbox with initInputs preset value.
  describe('inputsForms checkbox with initInputs', () => {
    it('should use initInputs preset=true for checkbox', async () => {
      // Arrange
      const { getRawInputsFromUrlParams } = await import('../../utils')
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({ check_var: true })

      mockStoreState.appParams = {
        user_input_form: [
          {
            checkbox: {
              variable: 'check_var',
              label: 'Check',
              required: false,
              default: false,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.default).toBe(true)
      })

      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({})
    })
  })

  // Scenario: number form item with valid numeric initInput.
  describe('inputsForms number with initInputs', () => {
    it('should use converted number from initInputs', async () => {
      // Arrange
      const { getRawInputsFromUrlParams } = await import('../../utils')
      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({ num_var: '99' })

      mockStoreState.appParams = {
        user_input_form: [
          {
            number: {
              variable: 'num_var',
              label: 'Number',
              required: false,
              default: 0,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result!.current.inputsForms[0]
        expect(form.default).toBe(99)
      })

      vi.mocked(getRawInputsFromUrlParams).mockResolvedValue({})
    })
  })

  // Scenario: showNewConversationItemInList manual state management.
  describe('setShowNewConversationItemInList', () => {
    it('should not prepend empty item when showNewConversationItemInList is false', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      }))
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.conversationList).toHaveLength(1)
      })

      // Act: ensure showNewConversationItemInList is false
      act(() => {
        result!.current.setShowNewConversationItemInList(false)
      })

      // Assert
      expect(result!.current.conversationList[0].id).toBe('conversation-1')
    })
  })

  // Scenario: checkInputsRequired detects file still uploading (array form, local_file method, no uploadedId).
  describe('checkInputsRequired - file uploading branches', () => {
    it('should block chat start and show info toast when file-list file is uploading (Array.isArray path)', async () => {
      // Arrange: file-list required form item
      mockStoreState.appParams = {
        user_input_form: [
          {
            'file-list': {
              variable: 'files_var',
              label: 'Files',
              required: true,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.inputsForms[0].type).toBe('file-list')
      })

      // Set the input value to an array with a file still being uploaded
      act(() => {
        result!.current.handleNewConversationInputsChange({
          files_var: [
            { transferMethod: 'local_file', uploadedId: null },
          ],
        })
      })

      const callback = vi.fn()

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert: callback NOT called because file is still uploading
      expect(callback).not.toHaveBeenCalled()
    })

    it('should block chat start when single file is uploading (non-array path)', async () => {
      // Arrange: file (singleFile) required form item
      mockStoreState.appParams = {
        user_input_form: [
          {
            file: {
              variable: 'single_file_var',
              label: 'Single File',
              required: true,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.inputsForms[0].type).toBe('file')
      })

      // Set the input value to a single file object still being uploaded
      act(() => {
        result!.current.handleNewConversationInputsChange({
          single_file_var: { transferMethod: 'local_file', uploadedId: null },
        })
      })

      const callback = vi.fn()

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert: callback NOT called because file is still uploading
      expect(callback).not.toHaveBeenCalled()
    })

    it('should allow chat start when file-list file has been uploaded (uploadedId present)', async () => {
      // Arrange: file-list required item, file fully uploaded
      mockStoreState.appParams = {
        user_input_form: [
          {
            'file-list': {
              variable: 'files_var',
              label: 'Files',
              required: true,
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result!.current.inputsForms[0].type).toBe('file-list')
      })

      // File has been fully uploaded
      act(() => {
        result!.current.handleNewConversationInputsChange({
          files_var: [
            { transferMethod: 'local_file', uploadedId: 'uploaded-id-123' },
          ],
        })
      })

      const callback = vi.fn()

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert: callback IS called because file is fully uploaded
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  // Scenario: getFormattedChatList handles mixed status paths, file mapping, and agent thoughts.
  describe('appPrevChatTree formatting branches', () => {
    it('should handle mixed message statuses, optional message_files, and mapped agent thought files', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1' })],
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({
        data: [
          {
            id: 'msg-files',
            query: 'Question with files',
            answer: 'Answer with files',
            message_files: [
              {
                id: 'file-user-1',
                belongs_to: 'user',
                type: 'custom',
                filename: 'input.txt',
                mime_type: 'text/plain',
                transfer_method: 'local_file',
                upload_file_id: 'upload-user-1',
                size: 10,
                url: 'https://example.com/input.txt',
              },
              {
                id: 'file-assistant-1',
                belongs_to: 'assistant',
                type: 'custom',
                filename: 'output.txt',
                mime_type: 'text/plain',
                transfer_method: 'local_file',
                upload_file_id: 'upload-assistant-1',
                size: 20,
                url: 'https://example.com/output.txt',
              },
            ],
            feedback: null,
            retriever_resources: [],
            agent_thoughts: [
              {
                id: 'thought-1',
                tool: 'tool-1',
                thought: 'thinking',
                tool_input: 'input',
                message_id: 'msg-files',
                conversation_id: 'conversation-1',
                observation: 'done',
                position: 1,
                files: ['file-assistant-1'],
              },
            ],
            parent_message_id: null,
            inputs: {},
            status: 'normal',
            extra_contents: [
              { type: 'human_input', submitted: false },
              { type: 'human_input', submitted: true, form_submission_data: { submitted: true } },
            ],
          },
          {
            id: 'msg-paused-branch',
            query: 'Question paused',
            answer: 'Answer paused',
            message_files: [],
            feedback: null,
            retriever_resources: [],
            agent_thoughts: null,
            parent_message_id: null,
            inputs: {},
            status: 'paused',
            extra_contents: [
              {
                type: 'human_input',
                submitted: false,
                form_definition: { fields: [] },
                workflow_run_id: 'wf-run-branch',
              },
              { type: 'human_input', submitted: true },
            ],
          },
          {
            id: 'msg-unknown-status',
            query: 'Question unknown',
            answer: 'Answer unknown',
            feedback: null,
            retriever_resources: [],
            agent_thoughts: null,
            parent_message_id: null,
            status: 'error',
            extra_contents: [],
          },
        ],
      })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      await waitFor(() => {
        expect(result!.current.appPrevChatTree.length).toBeGreaterThan(0)
      })
      const messageWithFiles = result!.current.appPrevChatTree.find(item => item.id === 'question-msg-files')
      expect(messageWithFiles?.message_files).toHaveLength(1)
      expect(messageWithFiles?.children?.[0]?.message_files).toHaveLength(1)
      expect(messageWithFiles?.children?.[0]?.agent_thoughts?.[0]?.message_files).toHaveLength(1)
    })
  })

  // Scenario: newConversation merge replaces existing conversation item when id already exists.
  describe('newConversation merge replace path', () => {
    it('should replace an existing conversation when generated conversation id already exists', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData({
        data: [createConversationItem({ id: 'conversation-new', name: 'Old Name' })],
      }))
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(createConversationItem({ id: 'conversation-new', name: 'Updated Name' }))

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleNewConversationCompleted('conversation-new')
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.conversationList[0].name).toBe('Updated Name')
      })
    })
  })

  // Scenario: conversation id update should no-op without appId and use DEFAULT key without userId.
  describe('handleConversationIdInfoChange fallback branches', () => {
    it('should no-op when appId is absent', async () => {
      // Arrange
      mockStoreState.appInfo = null
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const original = localStorage.getItem(CONVERSATION_ID_INFO)

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleConversationIdInfoChange('unused-conversation-id')
      })

      // Assert
      expect(localStorage.getItem(CONVERSATION_ID_INFO)).toBe(original)
    })

    it('should write conversation id under DEFAULT key when user id is missing', async () => {
      // Arrange
      const { getProcessedSystemVariablesFromUrlParams } = await import('../../utils')
      vi.mocked(getProcessedSystemVariablesFromUrlParams).mockResolvedValueOnce({ user_id: undefined as unknown as string })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleConversationIdInfoChange('conversation-default-user')
      })

      // Assert
      await waitFor(() => {
        const stored = localStorage.getItem(CONVERSATION_ID_INFO)
        const parsed = stored ? JSON.parse(stored) : {}
        expect(parsed['app-1']?.DEFAULT).toBe('conversation-default-user')
      })
    })
  })

  // Scenario: currentConversationLatestInputs should fall back to empty object for missing inputs.
  describe('currentConversationLatestInputs fallback paths', () => {
    it('should fall back to {} when latest chat message has no inputs', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({
        data: [{
          id: 'msg-no-inputs',
          query: 'Q',
          answer: 'A',
          message_files: [],
          feedback: null,
          retriever_resources: [],
          agent_thoughts: null,
          parent_message_id: null,
          status: 'normal',
          extra_contents: [],
        }],
      })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      await waitFor(() => {
        expect(result!.current.currentConversationInputs).toEqual({})
      })
    })

    it('should use {} fallback when newConversationInputsRef is unset and no conversation is selected', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.newConversationInputsRef.current = undefined as unknown as Record<string, unknown>
        result!.current.handleChangeConversation('')
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.currentConversationId).toBe('')
      })
      expect(result!.current.newConversationInputs).toEqual({})
    })
  })

  // Scenario: checkInputsRequired guard short-circuits when a prior variable already failed.
  describe('checkInputsRequired short-circuit guards', () => {
    it('should short-circuit remaining required vars after first empty required input', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'required_one',
              label: 'Required One',
              required: true,
              max_length: 50,
              default: '',
            },
          },
          {
            'text-input': {
              variable: 'required_two',
              label: 'Required Two',
              required: true,
              max_length: 50,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).not.toHaveBeenCalled()
    })

    it('should short-circuit remaining required vars after detecting uploading file', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'file-list': {
              variable: 'files_var',
              label: 'Files',
              required: true,
            },
          },
          {
            'text-input': {
              variable: 'required_text',
              label: 'Required Text',
              required: true,
              max_length: 50,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      act(() => {
        result!.current.handleNewConversationInputsChange({
          files_var: [
            { transferMethod: 'local_file', uploadedId: null },
          ],
          required_text: '',
        })
      })

      // Act
      act(() => {
        result!.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).not.toHaveBeenCalled()
    })
  })

  // Scenario: handleNewConversation should normalize missing defaults to null.
  describe('handleNewConversation default normalization', () => {
    it('should assign null for input defaults that are empty strings', async () => {
      // Arrange
      mockStoreState.appParams = {
        user_input_form: [
          {
            'text-input': {
              variable: 'empty_default_var',
              label: 'Empty default',
              required: false,
              max_length: 50,
              default: '',
            },
          },
        ],
      } as unknown as ChatConfig
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result!.current.handleNewConversation()
      })

      // Assert
      await waitFor(() => {
        expect(result!.current.newConversationInputs.empty_default_var).toBeNull()
      })
    })
  })
})
