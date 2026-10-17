import type { TrialAppDetailResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import type { ReactNode } from 'react'
import type { ChatConfig } from '../../types'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
import { gzipSync } from 'node:zlib'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import { AppToastHost } from '@/app/notifications/host'
import { useWebAppStore } from '@/context/web-app-context'
import { consoleQuery } from '@/service/console'
import {
  AppSourceType,
  fetchChatList,
  fetchConversations,
  generationConversationName,
} from '@/service/share'
import { TransferMethod } from '@/types/app'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../constants'
import { useEmbeddedChatbot } from '../hooks'

type InputForm = {
  variable: string
  type: string
  default?: unknown
  required?: boolean
  label?: string
  max_length?: number
  options?: string[]
  hide?: boolean
}

vi.mock('@/i18n/client', () => ({
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

const setUrlValues = (prefix: string, values: Record<string, string>) => {
  const params = new URLSearchParams(window.location.search)
  Object.entries(values).forEach(([key, value]) =>
    params.set(`${prefix}${key}`, gzipSync(value).toString('base64')),
  )
  window.history.replaceState({}, '', `/?${params}`)
}
const setUrlInputs = (values: Record<string, string>) => setUrlValues('', values)
const setSystemVariables = (values: Record<string, string>) => setUrlValues('sys.', values)

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

const STABLE_MOCK_DATA = { data: {} }
const createTryAppDetail = (id: string, title: string): TrialAppDetailResponse => ({
  id,
  name: title,
  mode: 'chat',
  enable_api: false,
  enable_site: true,
  site: { title, default_language: 'en-US' },
})
vi.mock('@/service/use-try-app', () => ({
  useGetTryAppParams: vi.fn(() => STABLE_MOCK_DATA),
}))

const mockFetchConversations = vi.mocked(fetchConversations)
const mockFetchChatList = vi.mocked(fetchChatList)
const mockGenerationConversationName = vi.mocked(generationConversationName)

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AppToastHost />
      {children}
    </QueryClientProvider>
  )
}

const renderWithClient = async <T,>(hook: () => T, setup?: (client: QueryClient) => void) => {
  useWebAppStore.setState(mockStoreState)
  const queryClient = createQueryClient()
  setup?.(queryClient)
  const wrapper = createWrapper(queryClient)
  let result: ReturnType<typeof renderHook<T, unknown>> | undefined
  act(() => {
    result = renderHook(hook, { wrapper })
  })
  await waitFor(
    () => {
      if (queryClient.isFetching() > 0) throw new Error('Queries are still fetching')
    },
    { timeout: 2000 },
  )
  return {
    queryClient,
    ...result!,
  }
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

describe('useEmbeddedChatbot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    mockGenerationConversationName.mockReset()
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    mockStoreState.appInfo = {
      app_id: 'app-1',
      end_user_id: 'user-1',
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
    mockFetchConversations.mockResolvedValue({ data: [], has_more: false, limit: 100 })
    mockFetchChatList.mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
  })

  describe('Share queries', () => {
    it('should load pinned, unpinned, and chat list data from share queries', async () => {
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

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

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
        expect(result.current.conversationList).toEqual(listData.data)
      })
    })

    it('should format chat list history correctly into appPrevChatList', async () => {
      // Provide a currentConversationId by rendering successfully
      mockStoreState.embeddedConversationId = 'conversation-1'
      setSystemVariables({
        conversation_id: 'conversation-1',
      })
      mockFetchChatList.mockResolvedValue({
        data: [
          {
            id: 'msg-1',
            query: 'Hello',
            answer: 'Hi there!',
            message_files: [
              { belongs_to: 'user', id: 'mf-1' },
              { belongs_to: 'assistant', id: 'mf-2' },
            ],
            agent_thoughts: [{ id: 'at-1' }],
            feedback: { rating: 'like' },
          },
        ],
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      // Wait for the mock to be called
      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledWith(
          'conversation-1',
          AppSourceType.webApp,
          'app-1',
        )
      })

      // Wait for the chat list to be populated
      await waitFor(() => {
        expect(result.current.appPrevChatList.length).toBeGreaterThan(0)
      })

      // We expect the formatting logic to split the message into question and answer ChatItems
      const chatList = result.current.appPrevChatList

      expect(chatList).toHaveLength(1)
      expect(chatList[0]).toMatchObject({
        id: 'question-msg-1',
        content: 'Hello',
        isAnswer: false,
        message_files: [expect.objectContaining({ id: 'mf-1' })],
        children: [
          expect.objectContaining({
            id: 'msg-1',
            content: 'Hi there!',
            isAnswer: true,
            feedback: { rating: 'like' },
            message_files: [expect.objectContaining({ id: 'mf-2' })],
          }),
        ],
      })
    })
  })

  describe('New conversation completion', () => {
    it('should invalidate share conversations and apply generated name', async () => {
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

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))
      mockFetchConversations.mockClear()

      act(() => {
        result.current.handleNewConversationCompleted('conversation-new')
      })

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
      await waitFor(() =>
        expect(mockFetchConversations).toHaveBeenCalledWith(
          AppSourceType.webApp,
          'app-1',
          undefined,
          false,
          100,
        ),
      )
    })
  })

  describe('Chat list gating', () => {
    it('should not refetch chat list when newConversationId matches current conversation', async () => {
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(
        createConversationItem({ id: 'conversation-1' }),
      )

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledTimes(1)
      })

      act(() => {
        result.current.handleNewConversationCompleted('conversation-1')
      })

      await waitFor(() => {
        expect(result.current.chatShouldReloadKey).toBe('')
      })
      expect(mockFetchChatList).toHaveBeenCalledTimes(1)
    })
  })

  describe('Conversation id persistence', () => {
    it('should store the current and last conversation after completion', async () => {
      const listData = createConversationData({
        data: [createConversationItem({ id: 'conversation-1', name: 'First' })],
      })
      mockFetchConversations.mockResolvedValue(listData)
      mockFetchChatList.mockResolvedValue({ data: [] })
      mockGenerationConversationName.mockResolvedValue(
        createConversationItem({ id: 'conversation-new' }),
      )

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleNewConversationCompleted('conversation-new')
      })

      await waitFor(() => {
        const lastStoredValue = localStorage.getItem(CONVERSATION_ID_INFO)
        const lastConversationIdInfo = lastStoredValue ? JSON.parse(lastStoredValue) : {}
        const tabStoredValue = sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)
        const tabConversationIdInfo = tabStoredValue ? JSON.parse(tabStoredValue) : {}

        expect(lastConversationIdInfo['app-1']?.['user-1']).toBe('conversation-new')
        expect(tabConversationIdInfo['app-1']?.['user-1']).toBe('conversation-new')
      })
    })
  })

  describe('TryApp mode', () => {
    it('should use tryApp source type and skip URL overrides and user fetch', async () => {
      const mockTryAppInfo = createTryAppDetail('try-app-1', 'Try App')
      mockStoreState.embeddedConversationId = null

      setSystemVariables({ conversation_id: 'web-only-conversation' })

      const { result } = await renderWithClient(
        () => useEmbeddedChatbot(AppSourceType.tryApp, 'try-app-1'),
        (client) => {
          const key = consoleQuery.trialApps.byAppId.get.queryKey({
            input: { params: { app_id: 'try-app-1' } },
          })
          client.setQueryDefaults(key, { staleTime: Infinity })
          client.setQueryData(key, mockTryAppInfo)
        },
      )

      expect(result.current.isInstalledApp).toBe(false)
      expect(result.current.appId).toBe('try-app-1')
      expect(result.current.appData?.site.title).toBe('Try App')

      expect(result.current.allowResetChat).toBe(true)
    })
  })

  describe('removeConversationIdInfo', () => {
    it('should successfully remove a stored conversation ID info by appId', async () => {
      // Setup some initial info
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({ 'app-1': { 'user-1': 'conv-id' } }),
      )
      sessionStorage.setItem(
        TAB_CONVERSATION_ID_INFO,
        JSON.stringify({ 'app-1': { 'user-1': 'conv-id' } }),
      )

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.removeConversationIdInfo()
      })

      await waitFor(() => {
        const storedValue = localStorage.getItem(CONVERSATION_ID_INFO)
        const parsed = storedValue ? JSON.parse(storedValue) : {}
        expect(parsed['app-1']).toBeUndefined()
        const tabStoredValue = sessionStorage.getItem(TAB_CONVERSATION_ID_INFO)
        const tabParsed = tabStoredValue ? JSON.parse(tabStoredValue) : {}
        expect(Object.values(tabParsed['app-1'] ?? {})).toContain('')
      })
    })
  })

  describe('inputsForms mapping and default parsing', () => {
    const mockAppParamsWithInputs = {
      user_input_form: [
        { paragraph: { variable: 'p1', default: 'para', max_length: 5 } },
        { number: { variable: 'n1', default: 42 } },
        { checkbox: { variable: 'c1', default: true } },
        { select: { variable: 's1', options: ['A', 'B'], default: 'A' } },
        { 'file-list': { variable: 'fl1' } },
        { file: { variable: 'f1' } },
        { json_object: { variable: 'j1' } },
        { 'text-input': { variable: 't1', default: 'txt', max_length: 3 } },
      ],
    }

    it('should map various types properly with max_length truncation when defaults supplied via URL', async () => {
      setUrlInputs({
        p1: 'toolongparagraph', // truncated to 5
        n1: '99',
        c1: 'true',
        s1: 'B', // Matches options
        t1: '1234', // truncated to 3
      })
      mockStoreState.appParams = mockAppParamsWithInputs as unknown as ChatConfig

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(
          result.current.inputsForms.find((form: InputForm) => form.variable === 'n1')?.default,
        ).toBe(99)
      })

      const forms = result.current.inputsForms
      expect(forms.find((f: InputForm) => f.variable === 'p1')?.default).toBe('toolo')
      expect(forms.find((f: InputForm) => f.variable === 'n1')?.default).toBe(99)
      expect(forms.find((f: InputForm) => f.variable === 'c1')?.default).toBe(true)
      expect(forms.find((f: InputForm) => f.variable === 's1')?.default).toBe('B')
      expect(forms.find((f: InputForm) => f.variable === 't1')?.default).toBe('123')
      expect(forms.find((f: InputForm) => f.variable === 'fl1')?.type).toBe('file-list')
      expect(forms.find((f: InputForm) => f.variable === 'f1')?.type).toBe('file')
      expect(forms.find((f: InputForm) => f.variable === 'j1')?.type).toBe('json_object')
    })

    it('should preserve numeric zero supplied via URL params', async () => {
      setUrlInputs({ n1: '0' })
      mockStoreState.appParams = {
        user_input_form: [{ number: { variable: 'n1', default: 10 } }],
      } as unknown as ChatConfig

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(result.current.inputsForms).toHaveLength(1)
      })
      await waitFor(() => expect(result.current.inputsForms[0].default).toBe(0))
      await waitFor(() => {
        expect(result.current.newConversationInputsRef.current.n1).toBe(0)
      })
    })
  })

  describe('checkInputsRequired and handleStartChat', () => {
    it('should fail checkInputsRequired when required fields are missing', async () => {
      mockStoreState.appParams = {
        user_input_form: [{ 'text-input': { variable: 't1', required: true, label: 'T1' } }],
      } as unknown as ChatConfig

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleNewConversationInputsChange({
          t1: '',
        })
      })
      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })

      expect(onStart).not.toHaveBeenCalled()
    })

    it('should accept numeric zero for a required number input', async () => {
      mockStoreState.appParams = {
        user_input_form: [{ number: { variable: 'n1', required: true, label: 'N1' } }],
      } as unknown as ChatConfig

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleNewConversationInputsChange({ n1: 0 })
      })
      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })

      expect(onStart).toHaveBeenCalled()
    })
  })

  describe('Event Handlers', () => {
    it('handleNewConversation sets clearChatList to true for webApp', async () => {
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await act(async () => {
        await result.current.handleNewConversation()
      })

      expect(result.current.clearChatList).toBe(true)
    })

    it('handleNewConversation sets clearChatList to true for tryApp without complex parsing', async () => {
      const { result } = await renderWithClient(
        () => useEmbeddedChatbot(AppSourceType.tryApp, 'app-try-1'),
        (client) => {
          const key = consoleQuery.trialApps.byAppId.get.queryKey({
            input: { params: { app_id: 'app-try-1' } },
          })
          client.setQueryDefaults(key, { staleTime: Infinity })
          client.setQueryData(key, createTryAppDetail('app-try-1', 'Try App'))
        },
      )

      await act(async () => {
        await result.current.handleNewConversation()
      })

      expect(result.current.clearChatList).toBe(true)
    })

    it('handleChangeConversation updates current conversation and refetches chat list', async () => {
      mockStoreState.embeddedConversationId = null
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleChangeConversation('another-convo')
      })

      await waitFor(() => {
        expect(result.current.currentConversationId).toBe('another-convo')
      })
      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledWith(
          'another-convo',
          AppSourceType.webApp,
          'app-1',
        )
      })
      expect(result.current.newConversationId).toBe('')
      expect(result.current.clearChatList).toBe(false)
    })

    it('should prioritize URL conversation_id over localStorage', async () => {
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({
          'app-1': { 'embedded-user-1': 'stored-conv-id' },
        }),
      )
      mockStoreState.embeddedConversationId = 'url-conv-id'
      setSystemVariables({
        user_id: 'embedded-user-1',
        conversation_id: 'url-conv-id',
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(result.current.currentConversationId).toBe('url-conv-id')
      })
    })

    it('should fall back to localStorage when no URL conversation_id is provided', async () => {
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({
          'app-1': { 'user-1': 'stored-conv-id' },
        }),
      )
      mockStoreState.embeddedConversationId = null
      mockStoreState.embeddedUserId = null

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(result.current.currentConversationId).toBe('stored-conv-id')
      })
    })

    it('handleFeedback invokes updateFeedback service successfully', async () => {
      const { updateFeedback } = await import('@/service/share')
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await act(async () => {
        await result.current.handleFeedback('msg-123', { rating: 'like' })
      })

      expect(updateFeedback).toHaveBeenCalledExactlyOnceWith(
        {
          url: '/messages/msg-123/feedbacks',
          body: { rating: 'like', content: undefined },
        },
        AppSourceType.webApp,
        'app-1',
      )
    })
  })

  describe('Language settings', () => {
    it('should set language from URL parameters', async () => {
      window.history.replaceState({}, '', '/?locale=zh-Hans')
      const { changeLanguage } = await import('@/i18n/client')

      await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      expect(changeLanguage).toHaveBeenCalledWith('zh-Hans')
      window.history.replaceState({}, '', '/')
    })

    it('should set language from system variables when URL param is missing', async () => {
      setSystemVariables({ locale: 'fr-FR' })
      const { changeLanguage } = await import('@/i18n/client')

      await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => expect(changeLanguage).toHaveBeenCalledWith('fr-FR'))
    })

    it('should fall back to app default language', async () => {
      setSystemVariables({})
      mockStoreState.appInfo = {
        app_id: 'app-1',
        site: {
          title: 'Test App',
          default_language: 'ja-JP',
        },
      } as unknown as AppData
      const { changeLanguage } = await import('@/i18n/client')

      await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      expect(changeLanguage).toHaveBeenCalledWith('ja-JP')
    })
  })

  describe('Additional Input Form Edges', () => {
    it('should handle invalid number inputs and checkbox defaults', async () => {
      mockStoreState.appParams = {
        user_input_form: [
          { number: { variable: 'n1', default: 10 } },
          { checkbox: { variable: 'c1', default: false } },
        ],
      } as unknown as ChatConfig
      setUrlInputs({
        n1: 'not-a-number',
        c1: 'true',
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))
      const forms = result.current.inputsForms
      expect(forms.find((f) => f.variable === 'n1')?.default).toBe(10)
      expect(forms.find((f) => f.variable === 'c1')?.default).toBe(false)
    })

    it('should handle select with invalid option and file-list/json types', async () => {
      mockStoreState.appParams = {
        user_input_form: [{ select: { variable: 's1', options: ['A'], default: 'A' } }],
      } as unknown as ChatConfig
      setUrlInputs({
        s1: 'INVALID',
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))
      expect(result.current.inputsForms[0].default).toBe('A')
    })
  })

  describe('handleConversationIdInfoChange logic', () => {
    it('should handle existing appId as string and update it to object', async () => {
      localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify({ 'app-1': 'legacy-id' }))
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleConversationIdInfoChange('new-conv-id')
      })

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO) || '{}')
        const appEntry = stored['app-1']
        expect(appEntry?.['user-1']).toBe('new-conv-id')
      })
    })

    it('should use the site EndUser when embeddedUserId is null', async () => {
      mockStoreState.embeddedUserId = null
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleConversationIdInfoChange('default-conv-id')
      })

      await waitFor(() => {
        const stored = JSON.parse(localStorage.getItem(CONVERSATION_ID_INFO) || '{}')
        const appEntry = stored['app-1']
        expect(appEntry?.['user-1']).toBe('default-conv-id')
      })
    })
  })

  describe('allInputsHidden and no required variables', () => {
    it('should pass checkInputsRequired immediately when there are no required fields', async () => {
      mockStoreState.appParams = {
        user_input_form: [
          // All optional (not required)
          { 'text-input': { variable: 't1', required: false, label: 'T1' } },
        ],
      } as unknown as ChatConfig

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })
      expect(onStart).toHaveBeenCalled()
    })

    it('should pass checkInputsRequired when all inputs are hidden', async () => {
      mockStoreState.appParams = {
        user_input_form: [
          { 'text-input': { variable: 't1', required: true, label: 'T1', hide: true } },
          { 'text-input': { variable: 't2', required: true, label: 'T2', hide: true } },
        ],
      } as unknown as ChatConfig

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => expect(result.current.allInputsHidden).toBe(true))

      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })
      expect(onStart).toHaveBeenCalled()
    })
  })

  describe('checkInputsRequired silent mode and multi-file', () => {
    it('should handle multi-file uploading status', async () => {
      mockStoreState.appParams = {
        user_input_form: [
          { 'file-list': { variable: 'files', required: true, type: InputVarType.multiFiles } },
        ],
      } as unknown as ChatConfig
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleNewConversationInputsChange({
          files: [
            { transferMethod: TransferMethod.local_file, uploadedId: 'ok' },
            { transferMethod: TransferMethod.local_file, uploadedId: null },
          ],
        })
      })

      // handleStartChat returns void, but we just verify no callback fires (file upload pending)
      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })
      expect(onStart).not.toHaveBeenCalled()
      act(() => {
        result.current.handleNewConversationInputsChange({
          files: [
            { transferMethod: TransferMethod.local_file, uploadedId: 'ok' },
            { transferMethod: TransferMethod.local_file, uploadedId: 'finished' },
          ],
        })
        result.current.handleStartChat(onStart)
      })
      expect(onStart).toHaveBeenCalledTimes(1)
    })

    it('should detect single-file upload still in progress', async () => {
      mockStoreState.appParams = {
        user_input_form: [{ file: { variable: 'f1', required: true, label: 'Attachment' } }],
      } as unknown as ChatConfig
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        // Single file (not array) transfer that hasn't finished uploading
        result.current.handleNewConversationInputsChange({
          f1: { transferMethod: TransferMethod.local_file, uploadedId: null },
        })
      })

      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })
      expect(onStart).not.toHaveBeenCalled()
    })
  })

  describe('currentConversationItem from pinned list', () => {
    it('should find currentConversationItem from pinned list when not in main list', async () => {
      mockStoreState.embeddedConversationId = null
      const pinnedData = createConversationData({
        data: [createConversationItem({ id: 'pinned-conv', name: 'Pinned' })],
      })
      mockFetchConversations.mockImplementation(
        async (_a: unknown, _b: unknown, _c: unknown, pinned?: boolean) => {
          return pinned ? pinnedData : createConversationData({ data: [] })
        },
      )
      mockFetchChatList.mockResolvedValue({ data: [] })
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({ 'app-1': { 'user-1': 'pinned-conv' } }),
      )

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(
        () => {
          expect(result.current.pinnedConversationList.length).toBeGreaterThan(0)
        },
        { timeout: 3000 },
      )
      await waitFor(
        () => {
          expect(result.current.currentConversationItem?.id).toBe('pinned-conv')
        },
        { timeout: 3000 },
      )
    })
  })

  describe('newConversation updates existing item', () => {
    it('should update an existing conversation in the list when its id matches', async () => {
      const initialItem = createConversationItem({ id: 'conversation-1', name: 'Old Name' })
      const renamedItem = createConversationItem({
        id: 'conversation-1',
        name: 'New Generated Name',
      })
      mockFetchConversations.mockResolvedValue(createConversationData({ data: [initialItem] }))
      mockGenerationConversationName.mockResolvedValue(renamedItem)

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => expect(result.current.conversationList.length).toBeGreaterThan(0))

      act(() => {
        result.current.handleNewConversationCompleted('conversation-1')
      })

      await waitFor(() => {
        const match = result.current.conversationList.find((c) => c.id === 'conversation-1')
        expect(match?.name).toBe('New Generated Name')
      })
    })
  })

  describe('currentConversationLatestInputs', () => {
    it('should return inputs from latest chat message when conversation has data', async () => {
      mockStoreState.embeddedConversationId = null
      const convId = 'conversation-with-inputs'
      localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify({ 'app-1': { 'user-1': convId } }))
      mockFetchConversations.mockResolvedValue(
        createConversationData({ data: [createConversationItem({ id: convId })] }),
      )
      mockFetchChatList.mockResolvedValue({
        data: [{ id: 'm1', query: 'Q', answer: 'A', inputs: { key1: 'val1' } }],
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => expect(result.current.currentConversationItem?.id).toBe(convId), {
        timeout: 3000,
      })
      await waitFor(
        () => expect(result.current.currentConversationInputs).toEqual({ key1: 'val1' }),
        {
          timeout: 3000,
        },
      )
    })
  })
})
