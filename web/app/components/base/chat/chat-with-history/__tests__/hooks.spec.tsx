import type { InstalledAppResponse } from '@dify/contracts/api/console/installed-apps/types.gen'
import type { ReactNode } from 'react'
import type { ChatConfig } from '../../types'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppToastHost } from '@/app/notifications/host'
import { useWebAppStore } from '@/context/web-app-context'
import { httpErrorFromResponse } from '@/service/http-error'
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
import { createChatConfigFixture as createChatConfig } from '@/test/fixtures/chat'
import { createHumanInputFormFixture } from '@/test/fixtures/workflow-process'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../constants'
import { useChatWithHistory } from '../hooks'

vi.mock('@/i18n/client', () => ({
  changeLanguage: vi.fn().mockResolvedValue(undefined),
}))

const initialAppState: {
  appInfo: AppData | null
  appMeta: AppMeta | null
  appParams: ChatConfig | null
} = {
  appInfo: null,
  appMeta: null,
  appParams: null,
}

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

const queryClients: QueryClient[] = []
const createQueryClient = () => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        retryDelay: 0,
      },
    },
  })

  queryClients.push(client)
  return client
}

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AppToastHost />
      {children}
    </QueryClientProvider>
  )
}

const renderWithClient = async <T,>(hook: () => T) => {
  useWebAppStore.setState(initialAppState)
  const queryClient = createQueryClient()
  const rendered = renderHook(hook, { wrapper: createWrapper(queryClient) })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  return { queryClient, ...rendered }
}

const setInputUrl = (inputs: Record<string, string>) => {
  window.history.replaceState({}, '', `/?${new URLSearchParams(inputs)}`)
}

const createConversationItem = (overrides: Partial<ConversationItem> = {}): ConversationItem => ({
  id: 'conversation-1',
  name: 'Conversation 1',
  inputs: null,
  introduction: '',
  ...overrides,
})

const createConversationData = (
  overrides: Partial<AppConversationData> = {},
): AppConversationData => ({
  data: [createConversationItem()],
  has_more: false,
  limit: 100,
  ...overrides,
})

const setConversationIdInfo = (appId: string, conversationId: string) => {
  const value = {
    [appId]: {
      'user-1': conversationId,
      DEFAULT: conversationId,
    },
  }
  localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify(value))
}

describe('useChatWithHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const service of [
      mockFetchConversations,
      mockFetchChatList,
      mockGenerationConversationName,
      mockDelConversation,
      mockPinConversation,
      mockUnpinConversation,
      mockRenameConversation,
      mockUpdateFeedback,
    ])
      service.mockReset()
    mockFetchConversations.mockResolvedValue(createConversationData())
    mockFetchChatList.mockResolvedValue({ data: [] })
    window.history.replaceState({}, '', '/')
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    localStorage.removeItem('webappSidebarCollapse')
    initialAppState.appInfo = {
      app_id: 'app-1',
      end_user_id: 'user-1',
      custom_config: null,
      site: {
        title: 'Test App',
        default_language: 'en-US',
      },
    }
    initialAppState.appMeta = {
      tool_icons: {},
    }
    initialAppState.appParams = null
    setConversationIdInfo('app-1', 'conversation-1')
  })

  afterEach(() => {
    queryClients.splice(0).forEach((client) => client.clear())
    vi.restoreAllMocks()
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    localStorage.removeItem('webappSidebarCollapse')
  })

  describe('Share queries', () => {
    it('should load pinned, unpinned, and chat list data from share queries', async () => {
      // Arrange
      const pinnedData = createConversationData({
        data: [createConversationItem({ id: 'pinned-1', name: 'Pinned' })],
      })
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      mockFetchConversations.mockImplementation(
        async (_isInstalledApp, _appId, _lastId, pinned) => {
          return pinned ? pinnedData : listData
        },
      )
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      await waitFor(() => {
        expect(mockFetchConversations).toHaveBeenCalledWith(
          AppSourceType.webApp,
          'app-1',
          undefined,
          true,
          100,
        )
      })
      await waitFor(() => {
        expect(mockFetchConversations).toHaveBeenCalledWith(
          AppSourceType.webApp,
          'app-1',
          undefined,
          false,
          100,
        )
      })
      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledWith(
          'conversation-1',
          AppSourceType.webApp,
          'app-1',
        )
      })
      await waitFor(() => {
        expect(result.current.pinnedConversationList).toEqual(pinnedData.data)
      })
      await waitFor(() => {
        expect(result.current.conversationList).toEqual(listData.data)
      })
    })
  })

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

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result.current.handleNewConversationCompleted('conversation-new')
      })

      // Assert
      await waitFor(() => {
        expect(mockGenerationConversationName).toHaveBeenCalledWith(
          AppSourceType.webApp,
          'app-1',
          'conversation-new',
        )
      })
      await waitFor(() => {
        expect(result.current.conversationList[0]).toEqual(generatedConversation)
      })
      expect(result.current.currentConversationId).toBe('conversation-new')
      expect(JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO)!)['app-1']['user-1']).toBe(
        'conversation-new',
      )
      expect(JSON.parse(sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)!)['app-1']['user-1']).toBe(
        'conversation-new',
      )
    })
  })

  describe('Chat list gating', () => {
    it('should not refetch chat list when newConversationId matches current conversation', async () => {
      // Arrange
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(
        createConversationItem({ id: 'conversation-1' }),
      )

      const { result } = await renderWithClient(() => useChatWithHistory())

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

    it('should clear a stale Environment selection when the server returns not found', async () => {
      window.history.replaceState({}, '', '/environment/workflow/environment-code')
      setConversationIdInfo('environment:environment-code', 'conversation-1')
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockRejectedValue(
        await httpErrorFromResponse(
          new Response(JSON.stringify({ reason: 'APPDEPLOY_CONVERSATION_NOT_FOUND' }), {
            status: 404,
          }),
        ),
      )

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledTimes(1)
      })
      await waitFor(() => {
        expect(result.current.currentConversationId).toBe('')
      })
      expect(result.current.clearChatList).toBe(true)
      const storedSelections = JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO)!)
      expect(storedSelections['environment:environment-code']['user-1']).toBe('')
    })

    it('should keep the selected Environment conversation for other errors', async () => {
      window.history.replaceState({}, '', '/environment/workflow/environment-code')
      setConversationIdInfo('environment:environment-code', 'conversation-1')
      mockFetchConversations.mockResolvedValue(createConversationData())
      const response = new Response(JSON.stringify({ reason: 'OTHER_ERROR' }), { status: 404 })
      mockFetchChatList.mockRejectedValue(response)

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledTimes(1)
      })
      expect(result.current.currentConversationId).toBe('conversation-1')
      expect(result.current.clearChatList).toBe(false)
      expect(localStorage.getItem(CONVERSATION_ID_INFO)).toContain('conversation-1')
    })
  })

  describe('Conversation id persistence', () => {
    it('should prefer the current tab conversation over the last conversation', async () => {
      // Arrange
      sessionStorage.setItem(
        TAB_CONVERSATION_ID_INFO,
        JSON.stringify({
          'app-1': {
            'user-1': 'conversation-in-this-tab',
            DEFAULT: 'conversation-in-this-tab',
          },
        }),
      )
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      expect(result.current.currentConversationId).toBe('conversation-in-this-tab')
      expect(mockFetchChatList).toHaveBeenCalledWith(
        'conversation-in-this-tab',
        AppSourceType.webApp,
        'app-1',
      )
    })

    it('should preserve a new chat selection in the current tab', async () => {
      // Arrange
      sessionStorage.setItem(
        TAB_CONVERSATION_ID_INFO,
        JSON.stringify({
          'app-1': {
            'user-1': '',
            DEFAULT: '',
          },
        }),
      )
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      expect(result.current.currentConversationId).toBe('')
      expect(mockFetchChatList).not.toHaveBeenCalled()
    })

    it('should isolate built-in and Environment conversations in the same browser', async () => {
      window.history.replaceState({}, '', '/environment/chat/environment-code')
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({
          'app-1': { 'user-1': 'built-in-conversation' },
          'environment:environment-code': { 'user-1': 'environment-conversation' },
        }),
      )
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      expect(result.current.currentConversationId).toBe('environment-conversation')
      expect(mockFetchChatList).toHaveBeenCalledWith(
        'environment-conversation',
        AppSourceType.webApp,
        'app-1',
      )
      expect(mockFetchChatList).not.toHaveBeenCalledWith(
        'built-in-conversation',
        AppSourceType.webApp,
        'app-1',
      )
    })

    it('should select by the current EndUser after access mode changes', async () => {
      window.history.replaceState({}, '', '/environment/chat/environment-code')
      initialAppState.appInfo = {
        ...initialAppState.appInfo!,
        end_user_id: 'authenticated-end-user',
      }
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({
          'environment:environment-code': {
            'anonymous-end-user': 'anonymous-conversation',
            'authenticated-end-user': 'authenticated-conversation',
          },
        }),
      )
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      expect(result.current.currentConversationId).toBe('authenticated-conversation')
      expect(mockFetchChatList).not.toHaveBeenCalledWith(
        'anonymous-conversation',
        AppSourceType.webApp,
        'app-1',
      )
    })

    it('waits for the EndUser and then restores only that user’s conversation', async () => {
      initialAppState.appInfo = { ...initialAppState.appInfo!, end_user_id: undefined }
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({
          'app-1': { DEFAULT: 'stale-conversation', 'user-1': 'personal-conversation' },
        }),
      )
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      expect(result.current.currentConversationId).toBe('')
      expect(mockFetchChatList).not.toHaveBeenCalled()

      act(() => {
        useWebAppStore
          .getState()
          .updateAppInfo({ ...initialAppState.appInfo!, end_user_id: 'user-1' })
      })
      await waitFor(() =>
        expect(result.current.currentConversationId).toBe('personal-conversation'),
      )
      await waitFor(() =>
        expect(mockFetchChatList).toHaveBeenCalledWith(
          'personal-conversation',
          AppSourceType.webApp,
          'app-1',
        ),
      )
      expect(mockFetchChatList).not.toHaveBeenCalledWith(
        'stale-conversation',
        AppSourceType.webApp,
        'app-1',
      )
    })

    it('should ignore last conversation updates from another tab', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result.current.currentConversationId).toBe('conversation-1')
      })

      // Act: storage events are delivered to the other tabs, not the tab that made the write.
      act(() => {
        setConversationIdInfo('app-1', 'conversation-from-another-tab')
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: CONVERSATION_ID_INFO,
          }),
        )
      })

      // Assert
      expect(result.current.currentConversationId).toBe('conversation-1')
      expect(mockFetchChatList).not.toHaveBeenCalledWith(
        'conversation-from-another-tab',
        AppSourceType.webApp,
        'app-1',
      )
    })
  })

  describe('Sidebar collapse', () => {
    it('persists collapse and expansion across remounts', async () => {
      const first = await renderWithClient(() => useChatWithHistory())
      act(() => first.result.current.handleSidebarCollapse(true))
      expect(localStorage.getItem('webappSidebarCollapse')).toBe('collapsed')
      first.unmount!()
      const second = await renderWithClient(() => useChatWithHistory())
      expect(second.result.current.sidebarCollapseState).toBe(true)
      act(() => second.result.current.handleSidebarCollapse(false))
      expect(localStorage.getItem('webappSidebarCollapse')).toBe('expanded')
      second.unmount!()
      const third = await renderWithClient(() => useChatWithHistory())
      expect(third.result.current.sidebarCollapseState).toBe(false)
    })
  })

  describe('Pin/Unpin conversation', () => {
    it('moves the conversation between lists after pinning and unpinning', async () => {
      let pinned = false
      const conversation = createConversationItem()
      mockFetchConversations.mockImplementation(async (_source, _appId, _lastId, requestedPinned) =>
        createConversationData({ data: requestedPinned === pinned ? [conversation] : [] }),
      )
      mockPinConversation.mockImplementation(async () => {
        pinned = true
      })
      mockUnpinConversation.mockImplementation(async () => {
        pinned = false
      })
      const { result } = await renderWithClient(() => useChatWithHistory())
      await waitFor(() => expect(result.current.conversationList).toEqual([conversation]))
      await act(async () => {
        await result.current.handlePinConversation(conversation.id)
      })
      expect(mockPinConversation).toHaveBeenCalledWith(
        AppSourceType.webApp,
        'app-1',
        conversation.id,
      )
      await waitFor(() => {
        expect(result.current.pinnedConversationList).toEqual([conversation])
        expect(result.current.conversationList).toEqual([])
      })
      await act(async () => {
        await result.current.handleUnpinConversation(conversation.id)
      })
      expect(mockUnpinConversation).toHaveBeenCalledWith(
        AppSourceType.webApp,
        'app-1',
        conversation.id,
      )
      await waitFor(() => {
        expect(result.current.pinnedConversationList).toEqual([])
        expect(result.current.conversationList).toEqual([conversation])
      })
    })
  })

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
        await result.current.handleDeleteConversation('other-conversation', { onSuccess })
      })

      // Assert
      expect(mockDelConversation).toHaveBeenCalledWith(
        AppSourceType.webApp,
        'app-1',
        'other-conversation',
      )
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
      mockDelConversation.mockReturnValueOnce(deletePromise)
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act: start first delete (does not immediately resolve, sets conversationDeleting=true)
      act(() => {
        result.current.handleDeleteConversation('other-conversation', { onSuccess })
      })

      // conversationDeleting is now true; second call should be skipped by guard
      await act(async () => {
        result.current.handleDeleteConversation('other-conversation', { onSuccess })
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
        expect(result.current.currentConversationId).toBe('conversation-1')
      })

      // Act: delete the current conversation
      await act(async () => {
        await result.current.handleDeleteConversation('conversation-1', { onSuccess })
      })

      // Assert: handleNewConversation side-effect: clearChatList set to true
      await waitFor(() => {
        expect(result.current.clearChatList).toBe(true)
      })
    })
  })

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
        expect(result.current.conversationList).toHaveLength(1)
      })

      // Act
      await act(async () => {
        await result.current.handleRenameConversation('conversation-1', 'New Name', { onSuccess })
      })

      // Assert
      expect(mockRenameConversation).toHaveBeenCalledWith(
        AppSourceType.webApp,
        'app-1',
        'conversation-1',
        'New Name',
      )
      expect(onSuccess).toHaveBeenCalledTimes(1)
      await waitFor(() => {
        expect(result.current.conversationList[0]!.name).toBe('New Name')
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
        await result.current.handleRenameConversation('conversation-1', '   ', { onSuccess })
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
      mockRenameConversation.mockReturnValueOnce(renamePromise)
      const onSuccess = vi.fn()

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act: start first rename (does not immediately resolve, sets conversationRenaming=true)
      act(() => {
        result.current.handleRenameConversation('conversation-1', 'Name A', { onSuccess })
      })

      // conversationRenaming is now true; second call should be skipped by guard
      await act(async () => {
        result.current.handleRenameConversation('conversation-1', 'Name B', { onSuccess })
        resolveRename()
      })

      // Only one actual rename call
      expect(mockRenameConversation).toHaveBeenCalledTimes(1)
    })
  })

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
        await result.current.handleFeedback('message-1', feedback)
      })

      // Assert
      expect(mockUpdateFeedback).toHaveBeenCalledWith(
        { url: '/messages/message-1/feedbacks', body: { rating: 'like', content: 'Great!' } },
        AppSourceType.webApp,
        'app-1',
      )
    })
  })

  describe('Handle new conversation', () => {
    it('should reset conversation state and show new item in list', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result.current.handleNewConversation()
      })

      // Assert
      await waitFor(() => {
        expect(result.current.currentConversationId).toBe('')
      })
      expect(result.current.clearChatList).toBe(true)
      expect(result.current.conversationList[0]!.id).toBe('')
      expect(result.current.appPrevChatTree).toEqual([])
    })
  })

  describe('Handle change conversation', () => {
    it('should clear newConversationId when switching to existing conversation', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(
        createConversationItem({ id: 'conversation-new' }),
      )

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Set a newConversationId first
      act(() => {
        result.current.handleNewConversationCompleted('conversation-new')
      })

      await waitFor(() => {
        expect(result.current.newConversationId).toBe('conversation-new')
      })

      // Act
      act(() => {
        result.current.handleChangeConversation('conversation-1')
      })

      // Assert
      await waitFor(() => {
        expect(result.current.newConversationId).toBe('')
      })
      expect(result.current.clearChatList).toBe(false)
    })
  })

  describe('inputsForms', () => {
    const input = { variable: 'input', label: 'Input', required: false }
    it.each([
      ['paragraph', { paragraph: { ...input, default: 'Draft' } }, 'Draft'],
      ['number', { number: { ...input, default: 42 } }, 42],
      ['checkbox', { checkbox: { ...input, default: false } }, false],
      ['select', { select: { ...input, default: 'a', options: ['a', 'b'] } }, 'a'],
      ['file-list', { 'file-list': input }, undefined],
      ['file', { file: input }, undefined],
      ['json_object', { json_object: input }, undefined],
      ['text-input', { 'text-input': { ...input, default: 'Name' } }, 'Name'],
    ] satisfies Array<[string, ChatConfig['user_input_form'][number], unknown]>)(
      'preserves %s schema and seeds its default into new chat inputs',
      async (type, form, defaultValue) => {
        initialAppState.appParams = createChatConfig({ user_input_form: [form] })
        const { result } = await renderWithClient(() => useChatWithHistory())
        await waitFor(() => {
          expect(result.current.inputsForms).toEqual([{ ...Object.values(form)[0], type }])
          expect(result.current.newConversationInputs).toEqual({ input: defaultValue ?? null })
        })
      },
    )

    it('should skip items with external_data_tool set', async () => {
      // Arrange
      initialAppState.appParams = createChatConfig({
        user_input_form: [
          {
            external_data_tool: {
              variable: 'text_var',
              label: 'Text',
              required: true,
            },
          },
        ],
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result.current.inputsForms).toHaveLength(0)
      })
    })
  })

  describe('handleStartChat', () => {
    it('should invoke callback and show new conversation item when inputs are valid', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Act
      act(() => {
        result.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should not invoke callback when required text input is missing', async () => {
      // Arrange
      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Act (inputs are empty, required field not filled)
      act(() => {
        result.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).not.toHaveBeenCalled()
    })

    it('should invoke callback when a required number input is zero', async () => {
      initialAppState.appParams = createChatConfig({
        user_input_form: [
          {
            number: {
              variable: 'required_number',
              label: 'Required Number',
              required: true,
              default: 0,
            },
          },
        ],
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result.current.newConversationInputsRef.current.required_number).toBe(0)
      })
      const callback = vi.fn()

      act(() => {
        result.current.handleStartChat(callback)
      })

      expect(callback).toHaveBeenCalledTimes(1)
    })

    it('should invoke callback when allInputsHidden is true regardless of required fields', async () => {
      // Arrange
      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()

      // Assert allInputsHidden is true
      await waitFor(() => {
        expect(result.current.allInputsHidden).toBe(true)
      })

      // Act
      act(() => {
        result.current.handleStartChat(callback)
      })

      // Assert
      expect(callback).toHaveBeenCalledTimes(1)
    })
  })

  describe('installedApp mode', () => {
    it('should use installedApp source type and derive appData from installedAppInfo', async () => {
      // Arrange
      const installedAppInfo: InstalledAppResponse = {
        id: 'installed-app-id',
        app_owner_tenant_id: 'tenant-id',
        editable: true,
        is_pinned: false,
        last_used_at: null,
        app: {
          id: 'app-id',
          name: 'Installed App',
          description: 'Installed app description',
          mode: 'chat',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
          icon_url: null,
          use_icon_as_answer_icon: false,
        },
      }
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory(installedAppInfo))

      // Assert
      expect(result.current.isInstalledApp).toBe(true)
      expect(result.current.appId).toBe('installed-app-id')
      expect(result.current.appData?.site.title).toBe('Installed App')
      expect(mockFetchConversations).toHaveBeenCalledWith(
        AppSourceType.installedApp,
        'installed-app-id',
        undefined,
        false,
        100,
      )
    })
  })

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
        expect(result.current.appPrevChatTree).toEqual([
          expect.objectContaining({
            id: 'question-msg-1',
            content: 'Hello',
            isAnswer: false,
            children: [
              expect.objectContaining({
                id: 'msg-1',
                content: 'Hi there',
                isAnswer: true,
                parentMessageId: 'question-msg-1',
              }),
            ],
          }),
        ])
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
                form_definition: createHumanInputFormFixture(),
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
        expect(result.current.appPrevChatTree.length).toBeGreaterThan(0)
      })

      const answerNode = result.current.appPrevChatTree[0]?.children?.[0]
      expect(answerNode?.humanInputFormDataList).toHaveLength(1)
      expect(answerNode?.workflow_run_id).toBe('wf-run-1')
    })

    it('preserves distinct legacy submissions without form definitions', async () => {
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
                form_submission_data: {
                  node_id: 'human-input',
                  node_title: 'Approval',
                  rendered_content: 'First approval',
                  action_id: 'approve',
                  action_text: 'Approve',
                },
              },
              {
                type: 'human_input',
                submitted: true,
                form_submission_data: {
                  node_id: 'human-input',
                  node_title: 'Approval',
                  rendered_content: 'Second approval',
                  action_id: 'approve',
                  action_text: 'Approve',
                },
              },
            ],
          },
        ],
      }
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue(chatListData)

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result.current.appPrevChatTree.length).toBeGreaterThan(0)
      })

      const answerNode = result.current.appPrevChatTree[0]?.children?.[0]
      const forms = answerNode!.humanInputFilledFormDataList!
      expect(forms.map((form) => form.rendered_content)).toEqual([
        'First approval',
        'Second approval',
      ])
      expect(forms[0]!.form_id).not.toBe(forms[1]!.form_id)
    })

    it('restores distinct same-Tool forms without removing the unsubmitted sibling', async () => {
      mockFetchConversations.mockResolvedValue(
        createConversationData({ data: [createConversationItem({ id: 'conversation-1' })] }),
      )
      const first = {
        form_id: 'first',
        node_id: 'tool',
        node_title: 'Tool',
        form_content: 'First approval',
        inputs: [],
        actions: [],
        form_token: 'first-token',
        display_in_ui: true,
        resolved_default_values: {},
        expiration_time: 100,
      }
      const second = {
        ...first,
        form_id: 'second',
        form_content: 'Second approval',
        form_token: 'second-token',
      }
      const filled = {
        node_id: 'tool',
        node_title: 'Tool',
        rendered_content: 'Approved',
        action_id: 'approve',
        action_text: 'Approve',
      }
      mockFetchChatList.mockResolvedValue({
        data: [
          {
            id: 'message',
            query: 'Approve both requests',
            answer: '',
            message_files: [],
            status: 'paused',
            extra_contents: [
              {
                type: 'human_input',
                submitted: false,
                workflow_run_id: 'run',
                form_definition: first,
              },
              {
                type: 'human_input',
                submitted: true,
                workflow_run_id: 'run',
                form_definition: second,
                form_submission_data: filled,
              },
            ],
          },
        ],
      })
      const { result } = await renderWithClient(() => useChatWithHistory())
      await waitFor(() => {
        const answer = result.current.appPrevChatTree[0]?.children?.[0]
        expect(answer?.humanInputFormDataList).toEqual([first])
        expect(answer?.humanInputFilledFormDataList).toEqual([
          { ...filled, form_id: 'second', form_content: 'Second approval', inputs: [] },
        ])
      })
    })

    it('should parse human input payloads regardless of message status', async () => {
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1' })],
      })
      const chatListData = {
        data: [
          {
            id: 'msg-status-agnostic',
            query: 'Needs review',
            answer: 'Pending follow-up',
            message_files: [],
            feedback: null,
            retriever_resources: [],
            agent_thoughts: null,
            parent_message_id: null,
            inputs: {},
            status: 'error',
            extra_contents: [
              {
                type: 'human_input',
                submitted: true,
                form_definition: {
                  form_id: 'form-1',
                  node_id: 'node-1',
                  node_title: 'Human Input',
                  form_content: '{{#$output.summary#}}',
                  inputs: [],
                  actions: [],
                  form_token: 'token-1',
                  resolved_default_values: {},
                  display_in_ui: true,
                  expiration_time: 0,
                },
                workflow_run_id: 'wf-run-status-agnostic',
                form_submission_data: {
                  node_id: 'node-1',
                  node_title: 'Human Input',
                  rendered_content: 'Submitted summary',
                  action_id: 'submit',
                  action_text: 'Submit',
                  submitted_data: {
                    summary: 'approved',
                  },
                },
              },
            ],
          },
        ],
      }
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue(chatListData)

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result.current.appPrevChatTree.length).toBeGreaterThan(0)
      })

      const answerNode = result.current.appPrevChatTree[0]?.children?.[0]
      expect(answerNode?.humanInputFormDataList).toHaveLength(0)
      expect(answerNode?.humanInputFilledFormDataList).toHaveLength(1)
      expect(answerNode?.humanInputFilledFormDataList?.[0]?.form_content).toBe(
        '{{#$output.summary#}}',
      )
      expect(answerNode?.humanInputFilledFormDataList?.[0]?.inputs).toEqual([])
      expect(answerNode?.workflow_run_id).toBe('wf-run-status-agnostic')
    })

    it('should return empty appPrevChatTree when there is no currentConversationId', async () => {
      // Arrange
      localStorage.removeItem(CONVERSATION_ID_INFO) // clear so no conversation selected
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      expect(result.current.appPrevChatTree).toEqual([])
    })
  })

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
        expect(result.current.currentConversationItem?.id).toBe('pinned-1')
      })
    })
  })

  describe('handleSidebarCollapse without appId', () => {
    it('should not update state when appId is absent', async () => {
      // Arrange
      initialAppState.appInfo = null // no app_id -> no appId
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())
      const initialState = result.current.sidebarCollapseState

      // Act
      act(() => {
        result.current.handleSidebarCollapse(true)
      })

      // Assert: state unchanged since appId is absent
      expect(result.current.sidebarCollapseState).toBe(initialState)
    })
  })

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
        result.current.handleConversationIdInfoChange('new-conversation')
      })

      // Assert: stored correctly without crash
      await waitFor(() => {
        const stored = localStorage.getItem(CONVERSATION_ID_INFO)
        const parsed = stored ? JSON.parse(stored) : {}
        expect(parsed['app-1']).toEqual({ 'user-1': 'new-conversation' })
      })
    })
  })

  describe('inputsForms value truncation', () => {
    it('should truncate paragraph value that exceeds max_length', async () => {
      // URL text values are bounded by the configured input length.
      setInputUrl({ para_var: 'toolong_value_over_5' })

      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result.current.inputsForms[0]
        // default should be the truncated value
        expect(form.default).toBe('toolo')
        expect(result.current.newConversationInputs.para_var).toBe('toolo')
      })
    })

    it('should truncate text-input value that exceeds max_length', async () => {
      // Arrange
      setInputUrl({
        text_var: 'exceeds_max_length_value',
      })

      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result.current.inputsForms[0]
        expect(form.default).toBe('exceeds')
        expect(result.current.newConversationInputs.text_var).toBe('exceeds')
      })
    })
  })

  describe('handleNewConversation with inputsForms', () => {
    it('should reset new conversation inputs to form defaults', async () => {
      // Arrange
      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Manually change inputs to something else
      act(() => {
        result.current.handleNewConversationInputsChange({ my_var: 'changed' })
      })

      expect(result.current.newConversationInputs).toEqual({ my_var: 'changed' })
      expect(result.current.newConversationInputsRef.current).toEqual({ my_var: 'changed' })
      // Act
      act(() => {
        result.current.handleNewConversation()
      })

      // Assert: inputs reset to form defaults
      await waitFor(() => {
        expect(result.current.newConversationInputs.my_var).toBe('default_val')
      })
    })
  })

  describe('inputsForms select option matching', () => {
    it('should use select default when initInput value is not in options', async () => {
      // Arrange
      setInputUrl({ sel_var: 'not_an_option' })

      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result.current.inputsForms[0]
        // not_an_option is not in options, so falls back to select.default
        expect(form.default).toBe('a')
      })
    })

    it('should use initInput value for select when it IS in options', async () => {
      // Arrange
      setInputUrl({ sel_var: 'b' })

      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result.current.inputsForms[0]
        // 'b' is in options so it's used as default
        expect(form.default).toBe('b')
      })
    })
  })

  describe('inputsForms number with initInputs', () => {
    it('should use converted number from initInputs', async () => {
      // Arrange
      setInputUrl({ num_var: '99' })

      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        const form = result.current.inputsForms[0]
        expect(form.default).toBe(99)
      })
    })
  })

  describe('inputsForms number numeric zero', () => {
    it('should preserve zero from URL params and seed it into new conversation inputs', async () => {
      setInputUrl({ num_var: '0' })

      initialAppState.appParams = createChatConfig({
        user_input_form: [
          {
            number: {
              variable: 'num_var',
              label: 'Number',
              required: false,
              default: 10,
            },
          },
        ],
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      await waitFor(() => {
        expect(result.current.inputsForms[0].default).toBe(0)
        expect(result.current.newConversationInputsRef.current.num_var).toBe(0)
      })
    })
  })

  describe('file input readiness', () => {
    it.each([
      ['file-list', [], false],
      ['file-list', [{ transferMethod: 'local_file', uploadedId: null }], false],
      ['file', { transferMethod: 'local_file', uploadedId: null }, false],
      ['file-list', [{ transferMethod: 'local_file', uploadedId: 'uploaded-1' }], true],
      ['file', { transferMethod: 'local_file', uploadedId: 'uploaded-1' }, true],
      ['file', { transferMethod: 'remote_url', url: 'https://example.com/file.txt' }, true],
    ])('validates %s value %j before starting chat', async (type, value, ready) => {
      initialAppState.appParams = createChatConfig({
        user_input_form: [
          type === 'file-list'
            ? { 'file-list': { variable: 'upload', label: 'Upload', required: true } }
            : { file: { variable: 'upload', label: 'Upload', required: true } },
        ],
      })
      const { result } = await renderWithClient(() => useChatWithHistory())
      const callback = vi.fn()
      act(() => {
        result.current.handleNewConversationInputsChange({ upload: value })
        result.current.handleStartChat(callback)
      })
      expect(callback).toHaveBeenCalledTimes(ready ? 1 : 0)
      if (ready) expect(result.current.conversationList[0]!.id).toBe('')
      else expect(result.current.conversationList.every((item) => item.id !== '')).toBe(true)
    })
  })

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
            answer_tokens: 10,
            message_tokens: 5,
            provider_response_latency: 66,
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
              {
                type: 'human_input',
                submitted: true,
                form_submission_data: {
                  node_id: 'human-input-1',
                  node_title: 'Human Input',
                  rendered_content: 'Approved',
                  action_id: 'approve',
                  action_text: 'Approve',
                },
              },
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
                form_definition: createHumanInputFormFixture(),
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
        expect(result.current.appPrevChatTree.length).toBeGreaterThan(0)
      })
      const messageWithFiles = result.current.appPrevChatTree.find(
        (item) => item.id === 'question-msg-files',
      )
      expect(messageWithFiles?.message_files).toHaveLength(1)
      expect(messageWithFiles?.children?.[0]?.message_files).toHaveLength(1)
      expect(messageWithFiles?.children?.[0]?.agent_thoughts?.[0]?.message_files).toHaveLength(1)

      const normalAnswerNode = messageWithFiles?.children?.[0]
      expect(normalAnswerNode?.more).toEqual({
        time: '',
        tokens: 15,
        latency: '66.00',
        tokens_per_second: '0.15',
      })
      const pausedAnswerNode = result.current.appPrevChatTree.find(
        (item) => item.id === 'question-msg-paused-branch',
      )?.children?.[0]

      expect(normalAnswerNode?.humanInputFilledFormDataList).toHaveLength(1)
      expect(normalAnswerNode?.humanInputFormDataList).toHaveLength(0)
      expect(pausedAnswerNode?.humanInputFormDataList).toHaveLength(1)
      expect(pausedAnswerNode?.humanInputFilledFormDataList).toHaveLength(0)
      expect(pausedAnswerNode?.workflow_run_id).toBe('wf-run-branch')
    })
  })

  describe('newConversation merge replace path', () => {
    it('should replace an existing conversation when generated conversation id already exists', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(
        createConversationData({
          data: [createConversationItem({ id: 'conversation-new', name: 'Old Name' })],
        }),
      )
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(
        createConversationItem({ id: 'conversation-new', name: 'Updated Name' }),
      )

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result.current.handleNewConversationCompleted('conversation-new')
      })

      // Assert
      await waitFor(() => {
        expect(result.current.conversationList[0]!.name).toBe('Updated Name')
      })
    })
  })

  describe('handleConversationIdInfoChange fallback branches', () => {
    it('should no-op when appId is absent', async () => {
      // Arrange
      initialAppState.appInfo = null
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const original = localStorage.getItem(CONVERSATION_ID_INFO)

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result.current.handleConversationIdInfoChange('unused-conversation-id')
      })

      // Assert
      expect(localStorage.getItem(CONVERSATION_ID_INFO)).toBe(original)
    })

    it('should use the site EndUser when the URL user id is missing', async () => {
      // Arrange
      window.history.replaceState({}, '', '/')
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })

      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result.current.handleConversationIdInfoChange('conversation-default-user')
      })

      // Assert
      await waitFor(() => {
        const stored = localStorage.getItem(CONVERSATION_ID_INFO)
        const parsed = stored ? JSON.parse(stored) : {}
        expect(parsed['app-1']?.['user-1']).toBe('conversation-default-user')
      })
    })
  })

  describe('currentConversationLatestInputs fallback paths', () => {
    it('should fall back to {} when latest chat message has no inputs', async () => {
      // Arrange
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({
        data: [
          {
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
          },
        ],
      })

      // Act
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Assert
      await waitFor(() => {
        expect(result.current.currentConversationInputs).toEqual({})
      })
    })
  })

  describe('handleNewConversation default normalization', () => {
    it('should assign null for input defaults that are empty strings', async () => {
      // Arrange
      initialAppState.appParams = createChatConfig({
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
      })
      mockFetchConversations.mockResolvedValue(createConversationData())
      mockFetchChatList.mockResolvedValue({ data: [] })
      const { result } = await renderWithClient(() => useChatWithHistory())

      // Act
      act(() => {
        result.current.handleNewConversation()
      })

      // Assert
      await waitFor(() => {
        expect(result.current.newConversationInputs.empty_default_var).toBeNull()
      })
    })
  })
})
