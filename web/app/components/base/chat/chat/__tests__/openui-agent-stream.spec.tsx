import type { OpenUiContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItemInTree } from '../../types'
import type { MessageContentEvent } from '@/features/generative-ui/protocol/types'
// oxlint-disable-next-line no-restricted-imports -- Verify the existing chat SSE callback contract.
import type { IOtherOptions } from '@/service/base'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
// oxlint-disable-next-line no-restricted-imports -- Mock the transport while exercising the real chat hook and renderer.
import { sseGet, ssePost } from '@/service/base'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { AgentRosterResponseContent } from '../answer/agent-roster-response-content'
import { ChatContextProvider } from '../context-provider'
import { useChat } from '../hooks'

vi.mock('@/service/base', () => ({ sseGet: vi.fn(), ssePost: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '' }))
vi.mock('@/app/components/base/audio-btn/audio.player.manager', () => ({
  AudioPlayerManager: { getInstance: vi.fn() },
}))

// oxlint-disable-next-line typescript/no-deprecated -- Exercise the shared transport boundary.
const postStream = vi.mocked(ssePost)
// oxlint-disable-next-line typescript/no-deprecated -- Exercise stream reattachment at the transport boundary.
const getStream = vi.mocked(sseGet)
const onSend = vi.fn()
const identity = { messageId: 'answer', conversationId: 'conversation', taskId: 'task' }
const replacement = {
  id: 'answer',
  task_id: 'task',
  conversation_id: 'conversation',
  answer: '',
  reason: 'generative_ui_final',
}
const initial: ChatItemInTree[] = [
  {
    id: 'question',
    content: 'Compare sales',
    isAnswer: false,
    children: [{ id: 'answer', content: '', isAnswer: true, children: [] }],
  },
]

function tableBlock(id: string, title: string, offset: number): OpenUiContentBlock {
  return {
    id,
    type: 'openui',
    library_version: 'dify-ui-v1',
    text_offset: offset,
    source: `root = Stack([Table("${title}", ["Region", "Sales"], [["East", "72"]])])`,
    status: 'completed',
    sequence: 3,
    form_state: {},
  }
}

function contentEvent(block: OpenUiContentBlock): MessageContentEvent {
  return {
    event: 'message_content',
    message_id: 'answer',
    conversation_id: 'conversation',
    task_id: 'task',
    data: block,
  }
}

function ChatHarness({
  mode = 'send',
  fetchHistory,
}: {
  mode?: 'send' | 'resume'
  fetchHistory?: () => Promise<unknown>
}) {
  const chat = useChat(
    undefined,
    undefined,
    mode === 'resume' ? initial : undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { isNewAgent: true },
  )
  const item = chat.chatList.find((message) => message.isAnswer)
  return (
    <ChatContextProvider chatList={chat.chatList} isResponding={chat.isResponding} onSend={onSend}>
      <button
        type="button"
        onClick={() =>
          mode === 'resume'
            ? chat.handleResume('answer', 'workflow', {})
            : chat.handleSend(
                '/chat-messages',
                { query: 'Compare sales' },
                { onGetConversationMessages: fetchHistory },
              )
        }
      >
        Start
      </button>
      {item && (
        <AgentRosterResponseContent
          item={item}
          content={item.content}
          responding={chat.isResponding}
        />
      )}
    </ChatContextProvider>
  )
}

describe('Agent OpenUI final replay', () => {
  let callbacks: IOtherOptions

  beforeAll(async () => {
    await import('@/features/generative-ui/renderer')
    await import('@/app/components/base/markdown/streamdown-wrapper')
  }, 30_000)
  beforeEach(() => {
    vi.clearAllMocks()
    postStream.mockImplementation(async (_url, _options, next) => {
      callbacks = next
    })
    getStream.mockImplementation(async (_url, _options, next) => {
      callbacks = next
    })
  })

  const streamLiveProgress = () => {
    callbacks.onData?.('Loading sales.\n\n', true, { ...identity, event: 'agent_message' })
    callbacks.onThought?.({
      id: 'load',
      message_id: 'answer',
      conversation_id: 'conversation',
      thought: '',
      answer: 'Loading sales.',
      tool: 'load_sales',
      tool_input: '',
      observation: 'Loaded',
      position: 1,
    })
    callbacks.onMessageContent?.(contentEvent(tableBlock('summary', 'Live preview', 16)))
    callbacks.onMessageContent?.(contentEvent(tableBlock('removed', 'Discarded result', 16)))
  }

  it('restores an interrupted live response from history without duplicating its prose', async () => {
    const user = userEvent.setup()
    const before = 'Before\n\n'
    const after = 'After'
    const block = tableBlock('partial', 'Partial sales', Array.from(before).length)
    const thought = {
      id: 'load',
      message_id: 'answer',
      conversation_id: 'conversation',
      thought: '',
      answer: before + after,
      tool: 'load_sales',
      tool_input: '',
      observation: 'Loaded',
      position: 1,
    }
    const fetchHistory = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'answer',
          answer: before + after,
          status: 'error',
          content_blocks: [block],
          agent_thoughts: [thought],
          metadata: { agent_response_is_partial: true },
        },
      ],
    })
    renderWithConsoleQuery(<ChatHarness fetchHistory={fetchHistory} />)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(() => {
      callbacks.onData?.(before, true, { ...identity, event: 'agent_message' })
      callbacks.onThought?.(thought)
      callbacks.onMessageContent?.(contentEvent(block))
      callbacks.onData?.(after, false, { ...identity, event: 'agent_message' })
      callbacks.onError?.('Stream interrupted')
    })
    await act(async () => callbacks.onCompleted?.(true))
    const table = await screen.findByRole('table', { name: 'Partial sales' })
    const beforeText = await screen.findByText('Before')
    const afterText = await screen.findByText('After')
    expect(
      beforeText.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(table.compareDocumentPosition(afterText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /thinking/i }))
    expect(screen.getByText('load_sales')).toBeVisible()
    expect(screen.getAllByText('Before')).toHaveLength(1)
    expect(screen.getAllByText('After')).toHaveLength(1)
    expect(screen.getAllByRole('table', { name: 'Partial sales' })).toHaveLength(1)
  })

  it.each(['send', 'resume'] as const)(
    'replaces live blocks before %s final replay and survives unavailable history',
    async (mode) => {
      const user = userEvent.setup()
      const fetchHistory = vi.fn().mockRejectedValue(new Error('History unavailable'))
      renderWithConsoleQuery(<ChatHarness mode={mode} fetchHistory={fetchHistory} />)
      await user.click(screen.getByRole('button', { name: 'Start' }))
      act(streamLiveProgress)
      expect(await screen.findByRole('table', { name: 'Live preview' })).toBeVisible()
      act(() => callbacks.onMessageReplace?.(replacement))
      expect(screen.queryByRole('table')).not.toBeInTheDocument()

      const conclusion = 'Conclusion \u{1F4CA}.\n\n'
      act(() => {
        callbacks.onMessageContent?.(contentEvent(tableBlock('summary', 'Final summary', 0)))
        callbacks.onData?.(conclusion, false, { ...identity, event: 'message' })
        callbacks.onMessageContent?.(
          contentEvent(tableBlock('added', 'New detail', Array.from(conclusion).length)),
        )
        callbacks.onData?.('Review the findings.', false, { ...identity, event: 'message' })
      })
      await act(async () => callbacks.onCompleted?.())

      const summary = await screen.findByRole('table', { name: 'Final summary' })
      const detail = screen.getByRole('table', { name: 'New detail' })
      const text = await screen.findByText(conclusion.trim())
      const suggestion = await screen.findByText('Review the findings.')
      expect(summary.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(text.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(
        detail.compareDocumentPosition(suggestion) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
      expect(screen.getAllByRole('table')).toHaveLength(2)
      expect(screen.getAllByText(conclusion.trim())).toHaveLength(1)
      expect(screen.queryByRole('table', { name: 'Discarded result' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /thinking/i }))
      expect(screen.getByText('load_sales')).toBeVisible()
    },
  )

  it.each(['send', 'resume'] as const)(
    'replaces moderated %s public prose before a final replay boundary',
    async (mode) => {
      const user = userEvent.setup()
      renderWithConsoleQuery(<ChatHarness mode={mode} />)
      await user.click(screen.getByRole('button', { name: 'Start' }))
      act(streamLiveProgress)
      expect(await screen.findByText('Loading sales.')).toBeVisible()
      act(() =>
        callbacks.onMessageReplace?.({
          ...replacement,
          reason: 'output_moderation',
          answer: 'Response unavailable.',
        }),
      )
      expect(await screen.findByText('Response unavailable.')).toBeVisible()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /thinking/i }))
      expect(screen.getByText('load_sales')).toBeVisible()
      expect(screen.queryByText('Loading sales.')).not.toBeInTheDocument()
    },
  )

  it('renders a UI-only final replay without waiting for a text event or history', async () => {
    const user = userEvent.setup()
    renderWithConsoleQuery(
      <ChatHarness
        fetchHistory={async () => {
          throw new Error('Offline')
        }}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    act(streamLiveProgress)
    act(() => {
      callbacks.onMessageReplace?.(replacement)
      callbacks.onMessageContent?.(contentEvent(tableBlock('only', 'Final UI', 0)))
    })
    expect(await screen.findByRole('table', { name: 'Final UI' })).toBeVisible()
    await act(async () => callbacks.onCompleted?.())
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.queryByText('Loading sales.')).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'keeps forms locked until the history refresh settles with stream error=%s',
    async (hasError) => {
      const user = userEvent.setup()
      let resolveHistory!: (value: unknown) => void
      const history = new Promise<unknown>((resolve) => {
        resolveHistory = resolve
      })
      const fetchHistory = vi.fn(() => history)
      renderWithConsoleQuery(<ChatHarness fetchHistory={fetchHistory} />)
      await user.click(screen.getByRole('button', { name: 'Start' }))
      const form: OpenUiContentBlock = {
        ...tableBlock('filters', 'unused', 0),
        source:
          'root = Stack([Form("filters", "Filter sales", "Apply filters", "Apply these filters", [TextField("keyword", "Keyword", "", false)])])',
        form_state: { filters: { keyword: { value: 'saved' } } },
      }
      act(() => {
        callbacks.onMessageReplace?.(replacement)
        callbacks.onMessageContent?.(contentEvent(form))
      })
      expect(await screen.findByRole('textbox', { name: 'Keyword' })).toBeDisabled()
      act(() => {
        if (hasError) callbacks.onError?.('Stream interrupted')
        callbacks.onCompleted?.(hasError)
      })
      expect(fetchHistory).toHaveBeenCalled()
      expect(screen.getByRole('textbox', { name: 'Keyword' })).toBeDisabled()
      await act(async () => {
        resolveHistory({ data: [{ id: 'answer', answer: '', content_blocks: [form] }] })
        await history
      })
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Keyword' })).toBeEnabled())
      await user.type(screen.getByRole('textbox', { name: 'Keyword' }), ' edit')
      expect(screen.getByRole('textbox', { name: 'Keyword' })).toHaveValue('saved edit')
    },
  )
})
