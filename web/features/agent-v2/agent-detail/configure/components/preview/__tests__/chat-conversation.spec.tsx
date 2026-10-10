import type {
  MessageDetailResponse,
  MessageInfiniteScrollPaginationResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { AgentPreviewChatController } from '../chat-conversation'
import type { MessageEnd, ThoughtItem } from '@/app/components/base/chat/chat/type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
// oxlint-disable-next-line no-restricted-imports -- Exercise useChat's existing SSE network boundary, not a new API call.
import { ssePost } from '@/service/base'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import { TransferMethod } from '@/types/app'
import { sendBuildChatMessage } from '../build-chat-request'
import { buildChatConfig } from '../chat-config'
import { AgentPreviewChatConversation } from '../chat-conversation'
import { getFormattedAgentDebugChatTree } from '../chat-history'
import { sendPreviewChatMessage } from '../preview-chat-request'

const historyGet = vi.hoisted(() =>
  vi.fn<(input: unknown) => Promise<MessageInfiniteScrollPaginationResponse>>(),
)

vi.mock('@/features/system-features/state', async () => {
  const { createSystemFeaturesStateModuleMock } = await import('@/test/console/state-fixture')
  return createSystemFeaturesStateModuleMock(() => ({ deploymentEdition: 'COMMUNITY' }))
})

// Keep Chat (including next/dynamic), useChat, Markdown and Dify UI real.
// Only transport, account data and routing are outside this integration boundary.
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const chatMessages = actual.consoleQuery.agent.byAgentId.chatMessages
  return {
    ...actual,
    consoleQuery: {
      account: actual.consoleQuery.account,
      agent: {
        byAgentId: {
          chatMessages: {
            get: {
              queryOptions: (options: Parameters<typeof chatMessages.get.queryOptions>[0]) => ({
                ...chatMessages.get.queryOptions(options),
                queryFn: () => historyGet(options.input),
              }),
            },
          },
        },
      },
    },
  }
})

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ agentId: 'agent-1' }),
  usePathname: () => '/agents/agent-1/configure',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

const thinkingName = /agentV2\.agentDetail\.configure\.answer\.thinking/
const stopName = 'appDebug.operation.stopResponding'
const config = buildChatConfig({ prompt: 'Inspect the brief and report the result.' })
const brief: FileEntity = {
  id: 'brief-1',
  name: 'brief.txt',
  size: 1024,
  type: 'text/plain',
  progress: 100,
  transferMethod: TransferMethod.local_file,
  supportFileType: 'document',
  uploadedId: 'upload-brief-1',
}

function createThoughts() {
  return [
    {
      id: 'thought-plan',
      message_id: 'answer-1',
      conversation_id: 'conversation-1',
      position: 1,
      thought: '## Inspect the brief before using tools',
      answer: '',
      tool: '',
      tool_input: '',
      observation: '',
      tool_labels: {},
      files: [],
    },
    {
      id: 'thought-tool',
      message_id: 'answer-1',
      conversation_id: 'conversation-1',
      position: 2,
      thought: 'Check the workspace files',
      answer: '',
      tool: 'shell_run',
      tool_input: '{"command":"ls /workspace"}',
      observation: 'brief.txt\nreport.txt',
      tool_labels: { shell_run: { en_US: 'List workspace files', zh_Hans: '列出工作区文件' } },
      files: [],
    },
  ] satisfies [ThoughtItem, ThoughtItem]
}

function createHistoryMessage(): MessageDetailResponse {
  return {
    id: 'answer-1',
    conversation_id: 'conversation-1',
    query: 'Inspect the attached brief',
    answer: 'The brief is ready for review.',
    inputs: {},
    message: [],
    message_files: [
      {
        id: brief.id,
        filename: brief.name,
        mime_type: brief.type,
        size: brief.size,
        type: 'document',
        transfer_method: TransferMethod.local_file,
        upload_file_id: brief.uploadedId,
        belongs_to: 'user',
      },
      {
        id: 'report-1',
        filename: 'report.txt',
        mime_type: 'text/plain',
        size: 2048,
        type: 'document',
        transfer_method: TransferMethod.remote_url,
        url: 'https://files.example.test/report.txt?signature=test',
        belongs_to: 'assistant',
      },
    ],
    agent_thoughts: createThoughts(),
    feedbacks: [],
    answer_tokens: 10,
    message_tokens: 5,
    provider_response_latency: 2,
    created_at: 1700000000,
    metadata: {},
    status: 'success',
    from_source: 'console',
  }
}

type Mode = 'preview' | 'build'

function ConversationHarness({
  initialMessages,
  mode,
}: {
  initialMessages: MessageDetailResponse[]
  mode: Mode
}) {
  const queryClient = useQueryClient()
  const controllerRef = useRef<AgentPreviewChatController>(null)
  const [open, setOpen] = useState(true)
  const [messages, setMessages] = useState(initialMessages)
  const [conversationId, setConversationId] = useState(initialMessages[0]?.conversation_id)

  return (
    <>
      <button
        type="button"
        onClick={() => void controllerRef.current?.send('Inspect the attached brief', [brief])}
      >
        Send attached brief
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        Close conversation
      </button>
      <button
        type="button"
        onClick={async () => {
          const history = await queryClient.query({
            ...consoleQuery.agent.byAgentId.chatMessages.get.queryOptions({
              input: {
                params: { agent_id: 'agent-1' },
                query: { conversation_id: conversationId! },
              },
            }),
            staleTime: 0,
          })
          setMessages(history.data)
          setOpen(true)
        }}
      >
        Open history
      </button>
      {open && (
        <section aria-label="Agent conversation">
          <AgentPreviewChatConversation
            ref={controllerRef}
            agentId="agent-1"
            clearChatList={false}
            config={config}
            conversationId={conversationId}
            draftType={mode === 'build' ? 'debug_build' : undefined}
            initialChatTree={getFormattedAgentDebugChatTree(messages)}
            inputs={{}}
            inputsForm={[]}
            sendMessage={mode === 'build' ? sendBuildChatMessage : sendPreviewChatMessage}
            speechToTextTarget={{
              type: 'agent',
              agentId: 'agent-1',
              draftType: mode === 'build' ? 'debug_build' : 'draft',
            }}
            onClearChatListChange={() => {}}
            onCurrentSessionConversationIdChange={setConversationId}
            onRuntimeStateChange={() => {}}
          />
        </section>
      )}
    </>
  )
}

function renderConversation(initialMessages: MessageDetailResponse[], mode: Mode = 'preview') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  seedAccountProfileQuery(queryClient)
  return render(
    <QueryClientProvider client={queryClient}>
      <ConversationHarness initialMessages={initialMessages} mode={mode} />
    </QueryClientProvider>,
  )
}

async function expectExpandedHistory(user: ReturnType<typeof userEvent.setup>) {
  const chat = within(screen.getByRole('region', { name: 'Agent conversation' }))
  // The real next/dynamic Chat loads its full dependency graph on the first render.
  const thinking = await chat.findByRole('button', { name: thinkingName }, { timeout: 10000 })
  expect(thinking).toHaveAttribute('aria-expanded', 'false')
  expect(
    chat.queryByRole('heading', { name: 'Inspect the brief before using tools' }),
  ).not.toBeInTheDocument()
  expect(await chat.findByText('The brief is ready for review.')).toBeVisible()

  await user.click(thinking)

  expect(
    await chat.findByRole('heading', { name: 'Inspect the brief before using tools', level: 2 }),
  ).toBeVisible()
  expect(
    chat.getAllByRole('heading', { name: 'Inspect the brief before using tools' }),
  ).toHaveLength(1)
  expect(chat.getAllByText('Check the workspace files')).toHaveLength(1)
  expect(chat.getAllByText('The brief is ready for review.')).toHaveLength(1)
  expect(chat.getAllByText('brief.txt', { exact: true })).toHaveLength(1)
  expect(chat.getAllByText('report.txt', { exact: true })).toHaveLength(1)
  const tool = chat.getByRole('button', { name: 'List workspace files' })
  expect(tool).toHaveAttribute('aria-expanded', 'false')
  await user.click(tool)
  expect(chat.getByText('{"command":"ls /workspace"}')).toBeVisible()
  expect(chat.getByText('brief.txt report.txt')).toBeVisible()
}

// Allow the first real dynamic Chat/Markdown import without extending missing-content waits.
describe('AgentPreviewChatConversation thought visibility', { timeout: 15000 }, () => {
  // Chat and Markdown both reach the DOM through next/dynamic; warm those chunks so
  // lazy resolution does not race the assertions.
  beforeAll(async () => {
    await Promise.all([
      import('@/app/components/base/chat/chat'),
      import('@/app/components/base/markdown/streamdown-wrapper'),
    ])
  })

  beforeEach(() => {
    vi.clearAllMocks()
    historyGet.mockResolvedValue({ data: [createHistoryMessage()], has_more: false, limit: 20 })
  })

  it('expands pure thoughts and tool details from initial history alongside the final answer', async () => {
    const user = userEvent.setup()
    renderConversation([createHistoryMessage()])

    await expectExpandedHistory(user)

    expect(ssePost).not.toHaveBeenCalled()
  })

  it.each<Mode>(['preview', 'build'])(
    'keeps %s streamed thoughts through history refill and reopening without duplicates',
    async (mode) => {
      const user = userEvent.setup()
      renderConversation([], mode)
      await user.click(screen.getByRole('button', { name: 'Send attached brief' }))
      await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(1))
      const [url, request, stream] = vi.mocked(ssePost).mock.calls[0]!
      expect(url).toBe('agent/agent-1/chat-messages')
      expect(request.body).toEqual(
        expect.objectContaining({
          response_mode: 'streaming',
          query: 'Inspect the attached brief',
          files: [
            {
              type: 'document',
              transfer_method: TransferMethod.local_file,
              url: '',
              upload_file_id: 'upload-brief-1',
            },
          ],
        }),
      )
      if (mode === 'build') expect(request.body).toHaveProperty('draft_type', 'debug_build')
      else expect(request.body).not.toHaveProperty('draft_type')

      await screen.findByRole('button', { name: stopName }, { timeout: 10000 })
      const history = createHistoryMessage()
      const [pureThought, toolThought] = createThoughts()
      act(() => stream!.onThought!(pureThought))
      expect(
        await screen.findByRole('heading', {
          name: 'Inspect the brief before using tools',
          level: 2,
        }),
      ).toBeVisible()
      expect(screen.getByRole('button', { name: thinkingName })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(screen.getByRole('button', { name: stopName })).toBeVisible()

      act(() => stream!.onThought!({ ...toolThought!, observation: '' }))
      await user.click(screen.getByRole('button', { name: 'List workspace files' }))
      expect(screen.getByText('{"command":"ls /workspace"}')).toBeVisible()
      expect(screen.queryByText('brief.txt report.txt')).not.toBeInTheDocument()
      act(() => stream!.onThought!(toolThought!))
      expect(await screen.findByText('brief.txt report.txt')).toBeVisible()
      expect(screen.getAllByRole('button', { name: 'List workspace files' })).toHaveLength(1)

      act(() =>
        stream!.onData!(history.answer, true, {
          event: 'agent_message',
          messageId: history.id,
          conversationId: history.conversation_id,
          taskId: 'task-1',
        }),
      )
      expect(await screen.findByText(history.answer)).toBeVisible()
      expect(
        screen.getAllByRole('heading', { name: 'Inspect the brief before using tools' }),
      ).toHaveLength(1)

      act(() =>
        stream!.onMessageEnd!({
          id: history.id,
          conversation_id: history.conversation_id,
          // Non-annotation SSE events omit annotation_reply; the legacy type requires it.
          metadata: {} as MessageEnd['metadata'],
          files: [
            {
              related_id: 'report-1',
              filename: 'report.txt',
              extension: 'txt',
              mime_type: 'text/plain',
              size: 2048,
              type: 'document',
              transfer_method: TransferMethod.remote_url,
              url: 'https://files.example.test/report.txt?signature=test',
              remote_url: '',
              upload_file_id: '',
            },
          ],
        }),
      )
      expect(screen.getAllByText('report.txt', { exact: true })).toHaveLength(1)

      // Keep the HTTP history request pending to distinguish stream completion from refill.
      const historyResponse = { data: [history], has_more: false, limit: 20 }
      let resolveHistory!: (response: typeof historyResponse) => void
      historyGet.mockReturnValueOnce(
        new Promise<typeof historyResponse>((resolve) => {
          resolveHistory = resolve
        }),
      )
      act(() => {
        void stream!.onCompleted!(false)
      })
      await waitFor(() =>
        expect(historyGet).toHaveBeenCalledWith({
          params: { agent_id: 'agent-1' },
          query: { conversation_id: 'conversation-1' },
        }),
      )
      expect(screen.queryByRole('button', { name: stopName })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: thinkingName })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(
        screen.getAllByRole('heading', { name: 'Inspect the brief before using tools' }),
      ).toHaveLength(1)
      expect(screen.getAllByText(history.answer)).toHaveLength(1)

      await act(async () => resolveHistory(historyResponse))
      await expectExpandedHistory(user)

      await user.click(screen.getByRole('button', { name: 'Close conversation' }))
      expect(screen.queryByRole('region', { name: 'Agent conversation' })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Open history' }))
      await expectExpandedHistory(user)
      expect(historyGet).toHaveBeenCalledTimes(2)
      expect(ssePost).toHaveBeenCalledTimes(1)
    },
  )
})
