import type { ReactNode } from 'react'
import type { EmbeddedChatbotContextValue } from '../../context'
import type { AppConversationData, AppData } from '@/models/share'
import { gzipSync } from 'node:zlib'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { useWebAppStore } from '@/context/web-app-context'
import { AppSourceType, fetchChatList, fetchConversations } from '@/service/share'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { createTestQueryClient } from '@/test/query-client'
import { EmbeddedChatbotContext } from '../../context'
import { useEmbeddedChatbot } from '../../hooks'
import InputsFormNode from '../index'

vi.mock('@/i18n/client', () => ({ changeLanguage: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/service/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/share')>()
  return {
    ...actual,
    fetchChatList: vi.fn<typeof actual.fetchChatList>(),
    fetchConversations: vi.fn<typeof actual.fetchConversations>(),
  }
})

const requiredInput = {
  'text-input': { variable: 'topic', label: 'Topic', required: true },
}
const EmbeddedChatbotContextProvider = EmbeddedChatbotContext.Provider

function FormOwner({ initiallyCollapsed = false }: { initiallyCollapsed?: boolean }) {
  const owner = useEmbeddedChatbot(AppSourceType.webApp)
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const contextValue: EmbeddedChatbotContextValue = {
    ...owner,
    appData: (owner.appData as AppData | undefined) ?? null,
    isMobile: false,
  }

  return (
    <EmbeddedChatbotContextProvider value={contextValue}>
      <InputsFormNode collapsed={collapsed} setCollapsed={setCollapsed} />
    </EmbeddedChatbotContextProvider>
  )
}

function renderOwner({
  children,
  appParams = createChatConfigFixture({ user_input_form: [requiredInput] }),
  conversationId = null,
}: {
  children?: ReactNode
  appParams?: ReturnType<typeof createChatConfigFixture>
  conversationId?: string | null
} = {}) {
  useWebAppStore.setState({
    appInfo: {
      app_id: 'app-1',
      end_user_id: 'user-1',
      custom_config: null,
      site: { title: 'Test App', default_language: 'en-US' },
    },
    appMeta: { tool_icons: {} },
    appParams,
    embeddedConversationId: conversationId,
    embeddedUserId: 'embedded-user-1',
  })
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <AppToaster timeout={0} />
      {children ?? <FormOwner />}
    </QueryClientProvider>,
  )
}

describe('InputsFormNode', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    localStorage.clear()
    sessionStorage.clear()
    vi.mocked(fetchConversations).mockReset().mockResolvedValue({
      data: [],
      has_more: false,
      limit: 100,
    })
    vi.mocked(fetchChatList).mockReset().mockResolvedValue({ data: [] })
  })

  it.each([
    createChatConfigFixture({
      user_input_form: [{ 'text-input': { ...requiredInput['text-input'], hide: true } }],
    }),
    createChatConfigFixture({ user_input_form: [] }),
  ])('omits settings when no input can be edited', (appParams) => {
    renderOwner({ appParams })
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'share.chat.startChat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.operation.close' })).not.toBeInTheDocument()
  })

  it('keeps invalid settings open, then collapses after a valid start and retains the input', async () => {
    const user = userEvent.setup()
    renderOwner()

    const topic = await screen.findByRole('textbox', { name: 'Topic' })
    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    expect(topic).toBeInTheDocument()

    await user.type(topic, 'Persistent topic')
    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Persistent topic')
  })

  it('lets an existing conversation reopen and close its settings without starting a new chat', async () => {
    const user = userEvent.setup()
    const params = new URLSearchParams({
      'sys.conversation_id': gzipSync('conv-123').toString('base64'),
    })
    window.history.replaceState({}, '', `/?${params}`)
    const conversations: AppConversationData = {
      data: [{ id: 'conv-123', name: 'Existing conversation', inputs: null, introduction: '' }],
      has_more: false,
      limit: 100,
    }
    vi.mocked(fetchConversations).mockResolvedValue(conversations)
    vi.mocked(fetchChatList).mockResolvedValue({
      data: [
        {
          id: 'message-1',
          query: 'Question',
          answer: 'Answer',
          inputs: { topic: 'Existing topic' },
          message_files: [],
        },
      ],
    })

    renderOwner({
      conversationId: 'conv-123',
      children: <FormOwner initiallyCollapsed />,
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('Existing topic'),
    )
    expect(screen.queryByRole('button', { name: 'share.chat.startChat' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()
  })
})
