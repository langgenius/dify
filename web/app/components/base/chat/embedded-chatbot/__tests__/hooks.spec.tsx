import type { TrialAppDetailResponse } from '@dify/contracts/api/console/trial-apps/types.gen'
import type { QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ChatConfig } from '../../types'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
import type { FileResponse } from '@/types/workflow'
import { gzipSync } from 'node:zlib'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppToastHost } from '@/app/notifications/host'
import { useWebAppStore } from '@/context/web-app-context'
import { consoleQuery } from '@/service/console'
import {
  AppSourceType,
  fetchChatList,
  fetchConversations,
  generationConversationName,
  updateFeedback,
} from '@/service/share'
import * as tryAppService from '@/service/try-app'
import { createChatConfigFixture, createChatFileFixture } from '@/test/fixtures/chat'
import { createTestQueryClient } from '@/test/query-client'
import { TransferMethod } from '@/types/app'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../constants'
import { useEmbeddedChatbot } from '../hooks'

vi.mock('@/i18n/client', () => ({
  changeLanguage: vi.fn().mockResolvedValue(undefined),
}))

const webAppState: {
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
    fetchChatList: vi.fn<typeof actual.fetchChatList>(),
    fetchConversations: vi.fn<typeof actual.fetchConversations>(),
    generationConversationName: vi.fn<typeof actual.generationConversationName>(),
    updateFeedback: vi.fn<typeof actual.updateFeedback>(),
  }
})

const createTryAppDetail = (id: string, title: string): TrialAppDetailResponse => ({
  id,
  name: title,
  mode: 'chat',
  enable_api: false,
  enable_site: true,
  site: { title, default_language: 'en-US' },
})

const seedTryApp = (client: QueryClient, id: string) => {
  const input = { params: { app_id: id } }
  client.setQueryData(
    consoleQuery.trialApps.byAppId.get.queryKey({ input }),
    createTryAppDetail(id, 'Try App'),
  )
  vi.spyOn(tryAppService, 'fetchTryAppParams').mockResolvedValue(
    createChatConfigFixture({ opening_statement: 'Try a conversation' }),
  )
}

const mockFetchConversations = vi.mocked(fetchConversations)
const mockFetchChatList = vi.mocked(fetchChatList)
const mockGenerationConversationName = vi.mocked(generationConversationName)

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AppToastHost />
      {children}
    </QueryClientProvider>
  )
}

const renderWithClient = async <T,>(hook: () => T, setup?: (client: QueryClient) => void) => {
  useWebAppStore.setState(webAppState)
  const queryClient = createTestQueryClient()
  setup?.(queryClient)
  const wrapper = createWrapper(queryClient)
  const result = renderHook(hook, { wrapper })
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
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

const createConversationData = (
  overrides: Partial<AppConversationData> = {},
): AppConversationData => ({
  data: [createConversationItem()],
  has_more: false,
  limit: 100,
  ...overrides,
})

const createMessageFile = (
  id: string,
  belongsTo: 'user' | 'assistant',
): FileResponse & {
  id: string
  belongs_to: 'user' | 'assistant'
} => ({
  id,
  belongs_to: belongsTo,
  related_id: id,
  extension: '.txt',
  filename: `${id}.txt`,
  size: 100,
  mime_type: 'text/plain',
  transfer_method: TransferMethod.local_file,
  type: 'document',
  url: `https://example.com/${id}.txt`,
  upload_file_id: `upload-${id}`,
  remote_url: '',
})

describe('useEmbeddedChatbot', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    mockGenerationConversationName.mockReset()
    vi.mocked(updateFeedback).mockReset().mockResolvedValue({})
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    webAppState.appInfo = {
      app_id: 'app-1',
      end_user_id: 'user-1',
      custom_config: null,
      site: {
        title: 'Test App',
        default_language: 'en-US',
      },
    }
    webAppState.appMeta = {
      tool_icons: {},
    }
    webAppState.appParams = null
    webAppState.embeddedConversationId = 'conversation-1'
    webAppState.embeddedUserId = 'embedded-user-1'
    mockFetchConversations.mockReset().mockResolvedValue({ data: [], has_more: false, limit: 100 })
    mockFetchChatList.mockReset().mockResolvedValue({ data: [] })
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
      webAppState.embeddedConversationId = 'conversation-1'
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
              createMessageFile('mf-1', 'user'),
              createMessageFile('mf-2', 'assistant'),
            ],
            agent_thoughts: [],
            feedback: { rating: 'like' },
          },
        ],
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(mockFetchChatList).toHaveBeenCalledWith(
          'conversation-1',
          AppSourceType.webApp,
          'app-1',
        )
      })

      await waitFor(() => {
        expect(result.current.appPrevChatList.length).toBeGreaterThan(0)
      })

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
      webAppState.embeddedConversationId = null

      setSystemVariables({ conversation_id: 'web-only-conversation' })

      const { result } = await renderWithClient(
        () => useEmbeddedChatbot(AppSourceType.tryApp, 'try-app-1'),
        (client) => seedTryApp(client, 'try-app-1'),
      )

      expect(result.current.isInstalledApp).toBe(false)
      expect(result.current.appId).toBe('try-app-1')
      expect(result.current.appData?.site.title).toBe('Try App')
      expect(result.current.appParams.opening_statement).toBe('Try a conversation')

      expect(result.current.allowResetChat).toBe(true)
    })
  })

  describe('removeConversationIdInfo', () => {
    it('should successfully remove a stored conversation ID info by appId', async () => {
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
    const appParamsWithInputs = createChatConfigFixture({
      user_input_form: [
        {
          paragraph: {
            variable: 'p1',
            default: 'para',
            max_length: 5,
            label: 'p1',
            required: false,
          },
        },
        { number: { variable: 'n1', default: 42, label: 'n1', required: false } },
        { checkbox: { variable: 'c1', default: true, label: 'c1', required: false } },
        {
          select: {
            variable: 's1',
            options: ['A', 'B'],
            default: 'A',
            label: 's1',
            required: false,
          },
        },
        { 'file-list': { variable: 'fl1', label: 'fl1', required: false } },
        { file: { variable: 'f1', label: 'f1', required: false } },
        { json_object: { variable: 'j1', label: 'j1', required: false } },
        {
          'text-input': {
            variable: 't1',
            default: 'txt',
            max_length: 3,
            label: 't1',
            required: false,
          },
        },
      ],
    })

    it('should map various types properly with max_length truncation when defaults supplied via URL', async () => {
      setUrlInputs({
        p1: 'toolongparagraph', // truncated to 5
        n1: '99',
        s1: 'B', // Matches options
        t1: '1234', // truncated to 3
      })
      webAppState.appParams = appParamsWithInputs

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(result.current.inputsForms.find((form) => form.variable === 'n1')?.default).toBe(99)
      })

      const forms = result.current.inputsForms
      expect(forms.find((f) => f.variable === 'p1')?.default).toBe('toolo')
      expect(forms.find((f) => f.variable === 'n1')?.default).toBe(99)
      expect(forms.find((f) => f.variable === 'c1')?.default).toBe(true)
      expect(forms.find((f) => f.variable === 's1')?.default).toBe('B')
      expect(forms.find((f) => f.variable === 't1')?.default).toBe('123')
      expect(forms.find((f) => f.variable === 'fl1')?.type).toBe('file-list')
      expect(forms.find((f) => f.variable === 'f1')?.type).toBe('file')
      expect(forms.find((f) => f.variable === 'j1')?.type).toBe('json_object')
    })

    it('should preserve numeric zero supplied via URL params', async () => {
      setUrlInputs({ n1: '0' })
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [
          { number: { variable: 'n1', default: 10, label: 'n1', required: false } },
        ],
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(result.current.inputsForms).toHaveLength(1)
      })
      await waitFor(() => expect(result.current.inputsForms[0].default).toBe(0))
      await waitFor(() => {
        expect(result.current.newConversationInputs.n1).toBe(0)
      })
    })
  })

  describe('checkInputsRequired and handleStartChat', () => {
    it('should fail checkInputsRequired when required fields are missing', async () => {
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [{ 'text-input': { variable: 't1', required: true, label: 'T1' } }],
      })

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
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [{ number: { variable: 'n1', required: true, label: 'N1' } }],
      })

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

    it('clears the trial conversation when starting a new chat', async () => {
      const { result } = await renderWithClient(
        () => useEmbeddedChatbot(AppSourceType.tryApp, 'app-try-1'),
        (client) => seedTryApp(client, 'app-try-1'),
      )

      await act(async () => {
        await result.current.handleNewConversation()
      })

      expect(result.current.clearChatList).toBe(true)
    })

    it('handleChangeConversation updates current conversation and refetches chat list', async () => {
      webAppState.embeddedConversationId = null
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
      webAppState.embeddedConversationId = 'url-conv-id'
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
      webAppState.embeddedConversationId = null
      webAppState.embeddedUserId = null

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(result.current.currentConversationId).toBe('stored-conv-id')
      })
    })

    it('handleFeedback invokes updateFeedback service successfully', async () => {
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await act(async () => {
        await result.current.handleFeedback('msg-123', { rating: 'like' })
      })

      expect(updateFeedback).toHaveBeenCalledExactlyOnceWith(
        {
          messageId: 'msg-123',
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
      webAppState.appInfo = {
        app_id: 'app-1',
        site: {
          title: 'Test App',
          default_language: 'ja-JP',
        },
        custom_config: null,
        end_user_id: 'user-1',
      }
      const { changeLanguage } = await import('@/i18n/client')

      await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      expect(changeLanguage).toHaveBeenCalledWith('ja-JP')
    })
  })

  it.each([
    {
      name: 'number',
      form: { number: { variable: 'value', label: 'Number', required: false, default: 10 } },
      value: 'not-a-number',
      expected: 10,
    },
    {
      name: 'select',
      form: {
        select: {
          variable: 'value',
          label: 'Choice',
          required: false,
          options: ['A'],
          default: 'A',
        },
      },
      value: 'INVALID',
      expected: 'A',
    },
  ])(
    'keeps the configured $name default after decoding an invalid URL value',
    async ({ form, value, expected }) => {
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [
          form,
          { 'text-input': { variable: 'marker', label: 'Marker', required: false } },
        ],
      })
      setUrlInputs({ value, marker: 'decoded' })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() =>
        expect(result.current.newConversationInputs).toEqual({
          value: expected,
          marker: 'decoded',
        }),
      )
    },
  )

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
      webAppState.embeddedUserId = null
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
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [{ 'text-input': { variable: 't1', required: false, label: 'T1' } }],
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })
      expect(onStart).toHaveBeenCalled()
    })

    it('should pass checkInputsRequired when all inputs are hidden', async () => {
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [
          { 'text-input': { variable: 't1', required: true, label: 'T1', hide: true } },
          { 'text-input': { variable: 't2', required: true, label: 'T2', hide: true } },
        ],
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => expect(result.current.allInputsHidden).toBe(true))

      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })
      expect(onStart).toHaveBeenCalled()
    })
  })

  describe('Required file inputs', () => {
    it('should handle multi-file uploading status', async () => {
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [{ 'file-list': { variable: 'files', required: true, label: 'files' } }],
      })
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleNewConversationInputsChange({
          files: [
            createChatFileFixture({ id: 'file-1', uploadedId: 'ok' }),
            createChatFileFixture({ id: 'file-2', uploadedId: undefined, progress: 30 }),
          ],
        })
      })

      const onStart = vi.fn()
      act(() => {
        result.current.handleStartChat(onStart)
      })
      expect(onStart).not.toHaveBeenCalled()
      act(() => {
        result.current.handleNewConversationInputsChange({
          files: [
            createChatFileFixture({ id: 'file-1', uploadedId: 'ok' }),
            createChatFileFixture({ id: 'file-2', uploadedId: 'finished' }),
          ],
        })
        result.current.handleStartChat(onStart)
      })
      expect(onStart).toHaveBeenCalledTimes(1)
    })

    it('should detect single-file upload still in progress', async () => {
      webAppState.appParams = createChatConfigFixture({
        user_input_form: [{ file: { variable: 'f1', required: true, label: 'Attachment' } }],
      })
      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      act(() => {
        result.current.handleNewConversationInputsChange({
          f1: createChatFileFixture({ id: 'file-2', uploadedId: undefined, progress: 30 }),
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
      webAppState.embeddedConversationId = null
      const pinnedData = createConversationData({
        data: [createConversationItem({ id: 'pinned-conv', name: 'Pinned' })],
      })
      mockFetchConversations.mockImplementation(async (_appSourceType, _appId, _lastId, pinned) => {
        return pinned ? pinnedData : createConversationData({ data: [] })
      })
      mockFetchChatList.mockResolvedValue({ data: [] })
      localStorage.setItem(
        CONVERSATION_ID_INFO,
        JSON.stringify({ 'app-1': { 'user-1': 'pinned-conv' } }),
      )

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => expect(result.current.currentConversationItem?.id).toBe('pinned-conv'))
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
      webAppState.embeddedConversationId = null
      const convId = 'conversation-with-inputs'
      localStorage.setItem(CONVERSATION_ID_INFO, JSON.stringify({ 'app-1': { 'user-1': convId } }))
      mockFetchConversations.mockResolvedValue(
        createConversationData({ data: [createConversationItem({ id: convId })] }),
      )
      mockFetchChatList.mockResolvedValue({
        data: [{ id: 'm1', query: 'Q', answer: 'A', inputs: { key1: 'val1' } }],
      })

      const { result } = await renderWithClient(() => useEmbeddedChatbot(AppSourceType.webApp))

      await waitFor(() => {
        expect(result.current.currentConversationItem?.id).toBe(convId)
        expect(result.current.currentConversationInputs).toEqual({ key1: 'val1' })
      })
    })
  })
})
