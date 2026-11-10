import type { OpenUiContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItemInTree } from '../../types'
import type { AppData } from '@/models/share'
import { gzipSync } from 'node:zlib'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vite-plus/test'
import { useWebAppStore } from '@/context/web-app-context'
import { saveGenerativeUIState } from '@/features/generative-ui/state-client'
// oxlint-disable-next-line no-restricted-imports -- Exercise trial continuation at the existing SSE network boundary.
import { ssePost } from '@/service/base'
import { AppSourceType, fetchChatList, fetchConversations } from '@/service/share'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import EmbeddedChatbot from '..'
import { CONVERSATION_ID_INFO, TAB_CONVERSATION_ID_INFO } from '../../constants'
import ChatWrapper from '../chat-wrapper'
import { EmbeddedChatbotContext } from '../context'

const ContextProvider = EmbeddedChatbotContext.Provider

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'share-code' }),
  usePathname: () => '/chatbot/share-code',
}))
vi.mock('@/i18n/client', () => ({ changeLanguage: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/app/components/base/amplitude/web-app-event', () => ({ trackWebAppEvent: vi.fn() }))
vi.mock('@/features/generative-ui/state-client', () => ({ saveGenerativeUIState: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: vi.fn(),
}))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchChatList: vi.fn(),
  fetchConversations: vi.fn(),
}))

// oxlint-disable-next-line typescript/no-deprecated -- Assert the existing SSE boundary preserves trial routing.
const mockSsePost = vi.mocked(ssePost)

const appData: AppData = {
  app_id: 'app-1',
  end_user_id: 'user-1',
  mode: 'chat',
  custom_config: null,
  site: { title: 'Embedded App', default_language: 'en-US' },
}
const appParams = createChatConfigFixture()

const createBlocks = (): OpenUiContentBlock[] => [
  {
    id: 'results',
    type: 'openui',
    library_version: 'dify-ui-v1',
    source: 'root = Stack([Table("Regional sales", ["Region", "Sales"], [["East", "72"]])])',
    text_offset: 0,
    sequence: 1,
    status: 'completed',
    form_state: {},
  },
  {
    id: 'filters',
    type: 'openui',
    library_version: 'dify-ui-v1',
    source:
      'root = Stack([Form("filters", "Filter sales", "Apply filters", "Apply these filters", [TextField("keyword", "Keyword", "", false)])])',
    text_offset: 0,
    sequence: 1,
    status: 'completed',
    form_state: { filters: { keyword: { value: 'saved' } } },
  },
]

describe('Embedded generative UI persistence', () => {
  beforeAll(async () => {
    await import('@/features/generative-ui/renderer')
  })

  beforeEach(() => {
    onTestFinished(guardUnexpectedFetch())
    const params = new URLSearchParams({
      'sys.conversation_id': gzipSync('conversation-1').toString('base64'),
    })
    window.history.replaceState({}, '', `/chatbot/share-code?${params}`)
    localStorage.removeItem(CONVERSATION_ID_INFO)
    sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    useWebAppStore.setState({
      appInfo: appData,
      appParams,
      appMeta: { tool_icons: {} },
      embeddedConversationId: 'conversation-1',
      embeddedUserId: null,
    })
    vi.mocked(fetchConversations).mockResolvedValue({ data: [], has_more: false, limit: 100 })
    vi.mocked(saveGenerativeUIState).mockReset()
    onTestFinished(() => {
      window.history.replaceState({}, '', '/')
      localStorage.removeItem(CONVERSATION_ID_INFO)
      sessionStorage.removeItem(TAB_CONVERSATION_ID_INFO)
    })
  })

  it('restores cards and edited form drafts after reopening the embedded conversation', async () => {
    const user = userEvent.setup()
    let storedBlocks = createBlocks()
    vi.mocked(fetchChatList).mockImplementation(async () => ({
      data: [
        {
          id: 'message-1',
          query: 'Compare regions',
          answer: 'East has the highest sales.',
          content_blocks: structuredClone(storedBlocks),
        },
      ],
    }))
    vi.mocked(saveGenerativeUIState).mockImplementation(
      async (_target, _messageId, blockId, state) => {
        const block = {
          ...storedBlocks.find((candidate) => candidate.id === blockId)!,
          form_state: structuredClone(state),
        }
        storedBlocks = storedBlocks.map((candidate) =>
          candidate.id === blockId ? block : candidate,
        )
        return { block }
      },
    )

    const firstVisit = renderWithConsoleQuery(<EmbeddedChatbot />)
    expect(await screen.findByRole('table', { name: 'Regional sales' })).toBeVisible()
    const keyword = await screen.findByRole('textbox', { name: 'Keyword' })
    expect(keyword).toHaveValue('saved')
    await user.clear(keyword)
    await user.type(keyword, 'hardware')
    await waitFor(() =>
      expect(saveGenerativeUIState).toHaveBeenLastCalledWith(
        { kind: 'webapp' },
        'message-1',
        'filters',
        expect.objectContaining({
          filters: expect.objectContaining({
            keyword: expect.objectContaining({ value: 'hardware' }),
          }),
        }),
      ),
    )
    expect(screen.getByRole('table', { name: 'Regional sales' })).toBeVisible()
    expect(keyword).toHaveValue('hardware')

    firstVisit.unmount()
    renderWithConsoleQuery(<EmbeddedChatbot />)

    expect(await screen.findByRole('table', { name: 'Regional sales' })).toBeVisible()
    expect(await screen.findByRole('textbox', { name: 'Keyword' })).toHaveValue('hardware')
    expect(screen.getByText('East has the highest sales.')).toBeVisible()
    expect(fetchChatList).toHaveBeenLastCalledWith('conversation-1', AppSourceType.webApp, 'app-1')
  })

  it('keeps trial forms usable without writing to the public webapp draft endpoint', async () => {
    const user = userEvent.setup()
    const messages: ChatItemInTree[] = [
      {
        id: 'question-1',
        content: 'Compare regions',
        isAnswer: false,
        children: [
          {
            id: 'message-1',
            parentMessageId: 'question-1',
            content: 'Choose the next filter.',
            isAnswer: true,
            children: [],
            content_blocks: createBlocks(),
          },
        ],
      },
    ]
    const context = createEmbeddedChatbotContextFixture({
      appSourceType: AppSourceType.tryApp,
      appId: 'trial-1',
      appData,
      appParams,
      currentConversationId: 'trial-conversation',
      appPrevChatList: messages,
    })
    renderWithConsoleQuery(
      <ContextProvider value={context}>
        <ChatWrapper />
      </ContextProvider>,
    )

    const keyword = await screen.findByRole('textbox', { name: 'Keyword' })
    await user.clear(keyword)
    await user.type(keyword, 'hardware')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() =>
      expect(mockSsePost).toHaveBeenCalledWith(
        'trial-apps/trial-1/chat-messages',
        expect.objectContaining({
          body: expect.objectContaining({ query: 'Apply these filters\n\nkeyword: hardware' }),
        }),
        expect.objectContaining({ isPublicAPI: false }),
      ),
    )
    expect(saveGenerativeUIState).not.toHaveBeenCalled()
  })
})
