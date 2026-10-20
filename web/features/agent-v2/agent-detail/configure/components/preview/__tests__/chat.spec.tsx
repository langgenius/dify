import type {
  AgentSoulConfig,
  MessageDetailResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type { ComponentProps } from 'react'
import type { AgentPreviewChatController } from '../chat-conversation'
import type { VoiceRecorder } from '@/app/components/base/voice-input/recorder'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { createRef, useState } from 'react'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/console'
import { createModelCatalogFixture, seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { createAgentFixture } from '@/test/fixtures/agent'
import { AgentBuildChat } from '../build-chat'
import { AgentPreviewChat } from '../preview-chat'

const ssePost = vi.hoisted(() => vi.fn<typeof import('@/service/base').ssePost>())
const api = vi.hoisted(() => ({
  history: vi.fn(),
  suggestions: vi.fn(),
  stop: vi.fn(),
  transcribe: vi.fn(),
  uploadRemote: vi.fn(),
  error: vi.fn<typeof import('@/app/notifications').toast.error>(),
  record: vi.fn<typeof import('@/app/components/base/voice-input/recorder').startVoiceRecorder>(),
}))
vi.mock('@/app/notifications', () => ({ toast: { error: api.error } }))
vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ agentId: 'agent-1' }),
  usePathname: () => '/agents/agent-1/configure',
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost,
}))
vi.mock('@/service/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/common')>()),
  uploadRemoteFileInfo: api.uploadRemote,
}))
// Audio capture/encoding is a platform boundary; keep VoiceInput and its service routing real.
vi.mock('@/app/components/base/voice-input/recorder', () => ({ startVoiceRecorder: api.record }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'agent.byAgentId.chatMessages.get': api.history,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'agent.byAgentId.chatMessages.byMessageId.suggestedQuestions.get': api.suggestions,
      'agent.byAgentId.chatMessages.byTaskId.stop.post': api.stop,
      'agent.byAgentId.audioToText.post': api.transcribe,
    }),
  }
})

const prefix = 'agentV2.agentDetail.configure'
const input = () =>
  screen.getByRole('textbox', { name: new RegExp(`${prefix}.(build|preview).inputPlaceholder`) })
const sendButton = () => screen.getByRole('button', { name: 'common.operation.send' })
const startBuildButton = () => screen.getByRole('button', { name: `${prefix}.build.startBuild` })
const historyKey = (id = 'conversation-1') =>
  consoleQuery.agent.byAgentId.chatMessages.get.queryKey({
    input: { params: { agent_id: 'agent-1' }, query: { conversation_id: id } },
  })
const createMessage = (overrides: Partial<MessageDetailResponse> = {}): MessageDetailResponse => ({
  id: 'message-0',
  conversation_id: 'conversation-1',
  query: 'Earlier question',
  answer: 'Earlier answer',
  inputs: {},
  message: [],
  message_files: [],
  agent_thoughts: [],
  feedbacks: [],
  answer_tokens: 3,
  message_tokens: 2,
  metadata: {},
  provider_response_latency: 1,
  status: 'normal',
  from_source: 'console',
  ...overrides,
})
const messages = new Map<string, MessageDetailResponse[]>()
const historyResponse = (data: MessageDetailResponse[]) => ({ data, has_more: false, limit: 20 })
const abortControllers: AbortController[] = []

beforeAll(async () => {
  // Preload the real dynamic Chat module before the timed interaction scenarios.
  await import('@/app/components/base/chat/chat')
})
beforeEach(() => {
  messages.clear()
  abortControllers.length = 0
  for (const mock of Object.values(api)) mock.mockReset()
  ssePost.mockReset().mockImplementation(async (_url, _body, options) => {
    const controller = new AbortController()
    abortControllers.push(controller)
    options.getAbortController?.(controller)
  })
  api.history.mockImplementation(async (request) =>
    historyResponse(messages.get(request.query.conversation_id) ?? []),
  )
  api.suggestions.mockResolvedValue({ data: ['What comes next?'] })
  api.stop.mockResolvedValue({ result: 'success' })
  api.transcribe.mockResolvedValue({ text: 'Transcribed request' })
  api.uploadRemote.mockResolvedValue({
    id: 'uploaded-1',
    name: 'brief.docx',
    size: 1024,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    url: 'https://example.com/brief.docx',
  })
  const recorder: VoiceRecorder = {
    // happy-dom has no audio device; only the analyser surface used by the recorder UI is needed.
    analyser: { frequencyBinCount: 0, getByteFrequencyData: vi.fn() } as unknown as AnalyserNode,
    stop: async () => new Blob(['recorded audio'], { type: 'audio/mp3' }),
    cancel: async () => {},
  }
  api.record.mockResolvedValue(recorder)
})

type ChatProps = ComponentProps<typeof AgentPreviewChat>
function ChatHarness({ mode, ...props }: ChatProps & { mode: 'preview' | 'build' }) {
  const [conversationId, setConversationId] = useState(props.conversationId)
  const [clearChatList, setClearChatList] = useState(false)
  const Chat = mode === 'build' ? AgentBuildChat : AgentPreviewChat
  return (
    <Chat
      {...props}
      conversationId={conversationId}
      clearChatList={clearChatList}
      onClearChatListChange={setClearChatList}
      onConversationIdChange={(id) => {
        setConversationId(id)
        props.onConversationIdChange?.(id)
      }}
    />
  )
}
function renderChat({
  mode = 'preview',
  edition = 'COMMUNITY',
  draft = {},
  ...props
}: Partial<ChatProps> & {
  mode?: 'build' | 'preview'
  edition?: 'COMMUNITY' | 'CLOUD'
  draft?: Partial<AgentSoulConfigFormState>
} = {}) {
  const { queryClient, wrapper: QueryProvider } = createConsoleQueryWrapper({
    systemFeatures: { deployment_edition: edition },
  })
  seedModelProviderQueries(queryClient, [createModelCatalogFixture()])
  queryClient.setQueryData(
    consoleQuery.agent.byAgentId.get.queryKey({ input: { params: { agent_id: 'agent-1' } } }),
    createAgentFixture(),
  )
  const store = createStore()
  store.set(queryClientAtom, queryClient)
  store.set(agentComposerDraftAtom, {
    ...defaultAgentSoulConfigFormState,
    prompt: 'You are helpful.',
    model: { provider: 'openai', model: 'gpt-4' },
    ...draft,
  })
  const view = render(
    <QueryProvider>
      <Provider store={store}>
        <ChatHarness
          agentId="agent-1"
          mode={mode}
          clearChatList={false}
          onClearChatListChange={() => {}}
          {...props}
        />
      </Provider>
    </QueryProvider>,
  )
  return { ...view, queryClient }
}
async function send(user: ReturnType<typeof userEvent.setup>, query = 'Hello') {
  await user.type(input(), query)
  await user.keyboard('{Enter}')
}
function stream(index = 0) {
  const options = ssePost.mock.calls[index]?.[2]
  if (!options) throw new Error('Expected an Agent SSE request')
  return options
}
async function receive(index = 0, answer = 'Streamed answer') {
  await waitFor(() => expect(ssePost.mock.calls[index]).toBeDefined())
  const body = ssePost.mock.calls[index]![1].body
  if (!body || typeof body !== 'object' || !('query' in body) || typeof body.query !== 'string')
    throw new Error('Expected a chat request body')
  messages.set('conversation-1', [
    ...(messages.get('conversation-1') ?? []),
    createMessage({
      id: `message-${index}`,
      query: body.query,
      answer,
      parent_message_id:
        'parent_message_id' in body && typeof body.parent_message_id === 'string'
          ? body.parent_message_id
          : null,
    }),
  ])
  await act(async () =>
    stream(index).onData?.(answer, true, {
      event: 'message',
      conversationId: 'conversation-1',
      messageId: `message-${index}`,
      taskId: `task-${index}`,
    }),
  )
}
async function complete(index = 0) {
  await act(async () => {
    await stream(index).onCompleted?.()
  })
}

describe('Agent conversation history', () => {
  it('renders persisted messages and regenerates the answer through the Agent endpoint', async () => {
    const user = userEvent.setup()
    messages.set('conversation-1', [createMessage()])
    renderChat({ conversationId: 'conversation-1' })
    expect(await screen.findByText('Earlier answer', {}, { timeout: 5000 })).toBeVisible()
    expect(screen.getByText('Earlier question')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'common.operation.regenerate' }))
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(ssePost).toHaveBeenCalledWith(
      'agent/agent-1/chat-messages',
      expect.objectContaining({
        body: expect.objectContaining({
          query: 'Earlier question',
          conversation_id: 'conversation-1',
          parent_message_id: null,
        }),
      }),
      expect.anything(),
    )
  }, 10000)

  it.each([false, true])(
    'preserves unsent text when history refreshes (existing messages: %s)',
    async (hasHistory) => {
      const user = userEvent.setup()
      messages.set('conversation-1', hasHistory ? [createMessage()] : [])
      const { queryClient } = renderChat({ conversationId: 'conversation-1' })
      await user.type(
        await screen.findByRole('textbox', {
          name: new RegExp(`${prefix}.preview.inputPlaceholder`),
        }),
        'Keep my draft',
      )
      messages.set('conversation-1', [createMessage({ answer: 'Refreshed answer' })])
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: historyKey() })
      })
      expect(await screen.findByText('Refreshed answer')).toBeVisible()
      expect(input()).toHaveValue('Keep my draft')
    },
  )

  it('shows historical thought answers and localized tool activity', async () => {
    const user = userEvent.setup()
    messages.set('conversation-1', [
      createMessage({
        answer: '',
        agent_thoughts: [
          {
            id: 'thought-1',
            files: [],
            message_id: 'message-0',
            thought: '',
            answer: 'Historical thought answer',
            tool: 'shell_run',
            tool_input: 'pwd',
            observation: '/workspace',
            position: 1,
            tool_labels: { shell_run: { en_US: 'Ran commands', zh_Hans: '运行了命令' } },
          },
        ],
      }),
    ])
    renderChat({ conversationId: 'conversation-1' })
    await user.click(
      await screen.findByRole('button', { name: new RegExp(`${prefix}.answer.thinking`) }),
    )
    expect(await screen.findByText('Historical thought answer')).toBeVisible()
    await user.click(screen.getByRole('button', { name: /Ran commands/ }))
    expect(await screen.findByText('/workspace')).toBeVisible()
  })

  it('keeps the live answer and input while completion fetches history, then reuses the conversation', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderChat({
      agentSoulConfig: {
        schema_version: 1,
        app_features: { suggested_questions_after_answer: { enabled: true } },
      },
    })
    await send(user)
    await receive()
    expect(await screen.findByText('Streamed answer')).toBeVisible()
    const pendingHistory = createDeferred<ReturnType<typeof historyResponse>>()
    api.history.mockReturnValueOnce(pendingHistory.promise)
    let completion: ReturnType<NonNullable<ReturnType<typeof stream>['onCompleted']>>
    act(() => {
      completion = stream().onCompleted?.()
    })
    await waitFor(() => expect(api.history).toHaveBeenCalled())
    expect(screen.getByText('Streamed answer')).toBeVisible()
    await user.type(input(), 'Next question')
    const response = historyResponse(messages.get('conversation-1')!)
    await act(async () => {
      pendingHistory.resolve(response)
      await completion
    })
    expect(input()).toHaveValue('Next question')
    expect(queryClient.getQueryData(historyKey())).toEqual(response)
    expect(await screen.findByText('What comes next?')).toBeVisible()
    expect(api.suggestions).toHaveBeenCalledWith({
      params: { agent_id: 'agent-1', message_id: 'message-0' },
    })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(2))
    expect(ssePost.mock.calls[1]?.[1].body).toMatchObject({
      conversation_id: 'conversation-1',
      query: 'Next question',
      parent_message_id: 'message-0',
    })
  })
})

describe('Agent sends and interruptions', () => {
  it('waits for saving before starting Build, then uses the normal send action for follow-ups', async () => {
    const user = userEvent.setup()
    const save = createDeferred<void>()
    const saveDraft = vi.fn(() => save.promise)
    renderChat({ mode: 'build', onSaveDraftBeforeRun: saveDraft })
    await user.type(input(), 'Build an agent')
    await user.click(startBuildButton())
    expect(saveDraft).toHaveBeenCalledOnce()
    expect(startBuildButton()).toHaveAttribute('aria-disabled', 'true')
    expect(ssePost).not.toHaveBeenCalled()
    await act(async () => save.resolve())
    await receive()
    await complete()
    expect(await screen.findByText('Streamed answer')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: `${prefix}.build.startBuild` }),
    ).not.toBeInTheDocument()
    await user.type(input(), 'Refine it')
    expect(sendButton()).toBeEnabled()
    await user.click(sendButton())
    await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(2))
    expect(ssePost.mock.calls[1]?.[1].body).toMatchObject({
      draft_type: 'debug_build',
      query: 'Refine it',
    })
  })

  it('keeps the input when saving fails and sends it on retry', async () => {
    const user = userEvent.setup()
    const saveDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error('Save failed'))
      .mockResolvedValue(undefined)
    renderChat({ onSaveDraftBeforeRun: saveDraft })
    await send(user, 'Keep this request')
    await waitFor(() => expect(saveDraft).toHaveBeenCalledOnce())
    expect(input()).toHaveValue('Keep this request')
    expect(ssePost).not.toHaveBeenCalled()
    await user.click(sendButton())
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(ssePost.mock.calls[0]?.[1].body).toMatchObject({ query: 'Keep this request' })
    expect(ssePost.mock.calls[0]?.[1].body).not.toHaveProperty('draft_type')
    expect(input()).toHaveValue('')
  })

  it('sends input defaults from the newly prepared build snapshot', async () => {
    const user = userEvent.setup()
    const soul = (city: string): AgentSoulConfig => ({
      schema_version: 1,
      app_variables: [{ name: 'city', type: 'text-input', default: city, required: true }],
    })
    renderChat({
      mode: 'build',
      agentSoulConfig: soul('London'),
      onSaveDraftBeforeRun: async () => soul('Paris'),
    })
    await send(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(ssePost.mock.calls[0]?.[1].body).toMatchObject({
      draft_type: 'debug_build',
      inputs: { city: 'Paris' },
    })
  })

  it.each(['button', 'controller'] as const)(
    'stops through the %s, aborts the stream, and reports a late error only once',
    async (stopVia) => {
      const user = userEvent.setup()
      const controllerRef = createRef<AgentPreviewChatController>()
      const interrupted = vi.fn()
      renderChat({ controllerRef, onSendInterrupted: interrupted })
      await send(user)
      await receive()
      if (stopVia === 'button')
        await user.click(
          await screen.findByRole('button', { name: 'appDebug.operation.stopResponding' }),
        )
      else await act(async () => controllerRef.current?.stop())
      expect(api.stop).toHaveBeenCalledExactlyOnceWith(
        {
          params: { agent_id: 'agent-1', task_id: 'task-0' },
        },
        { context: { silent: true } },
      )
      await waitFor(() => expect(abortControllers[0]?.signal.aborted).toBe(true))
      await act(async () => {
        stream().onError?.('Connection closed')
        await stream().onCompleted?.(true)
      })
      expect(interrupted).toHaveBeenCalledTimes(1)
      expect(
        screen.queryByRole('button', { name: 'appDebug.operation.stopResponding' }),
      ).not.toBeInTheDocument()
      await user.type(input(), 'Try again')
      expect(sendButton()).toBeEnabled()
    },
  )

  it('reports a failed stream to its owner and leaves the input usable', async () => {
    const user = userEvent.setup()
    const interrupted = vi.fn()
    renderChat({ onSendInterrupted: interrupted })
    await send(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await act(async () => stream().onError?.('Network unavailable'))
    expect(interrupted).toHaveBeenCalledOnce()
    await user.type(input(), 'Retry request')
    expect(sendButton()).toBeEnabled()
  })

  it.each([
    ['Agent run exceeded the configured limit of 3600 seconds', 'agentRunLimitExceeded'],
    ['The next request would exceed the request_limit of 500', 'agentModelRequestLimitExceeded'],
  ])('shows the dedicated limit explanation for %s', async (message, errorKey) => {
    const user = userEvent.setup()
    renderChat()
    await send(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    act(() => {
      stream().onNotifyError?.(message, 'agent_run_limit_exceeded')
    })
    expect(api.error).toHaveBeenCalledExactlyOnceWith(
      `${prefix}.preview.errors.${errorKey}`,
      expect.objectContaining({ timeout: 0 }),
    )
    render(<>{api.error.mock.calls[0]?.[1]?.description}</>)
    expect(screen.getByRole('link', { name: `${prefix}.rightPanel.learnMore` })).toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/self-host/use-dify/build/new-agent/build#publish',
    )
  })
})

describe('Agent voice input', () => {
  it.each([
    { mode: 'preview' as const, speechToTextDraftType: undefined, expected: 'draft' },
    { mode: 'build' as const, speechToTextDraftType: undefined, expected: 'debug_build' },
    { mode: 'build' as const, speechToTextDraftType: 'draft' as const, expected: 'draft' },
  ])(
    'transcribes $mode audio against $expected (override: $speechToTextDraftType)',
    async ({ expected, ...props }) => {
      const user = userEvent.setup()
      const save = createDeferred<void>()
      const beforeTranscribe = vi.fn(() => save.promise)
      renderChat({
        ...props,
        onBeforeSpeechToText: beforeTranscribe,
        agentSoulConfig: { schema_version: 1, app_features: { speech_to_text: { enabled: true } } },
      })
      await user.click(screen.getByRole('button', { name: 'common.voiceInput.start' }))
      await user.click(await screen.findByRole('button', { name: 'common.voiceInput.stop' }))
      await waitFor(() => expect(beforeTranscribe).toHaveBeenCalledOnce())
      expect(api.transcribe).not.toHaveBeenCalled()
      await act(async () => save.resolve())
      await waitFor(() => expect(input()).toHaveValue('Transcribed request'))
      expect(api.transcribe).toHaveBeenCalledWith(
        {
          params: { agent_id: 'agent-1' },
          body: { draft_type: expected, file: expect.any(File) },
        },
        { signal: expect.any(AbortSignal) },
      )
      expect(api.transcribe.mock.calls[0]?.[0].body.file.type).toBe('audio/mp3')
    },
  )
})

describe('Agent attachments and notices', () => {
  it('keeps attachments disabled until explicitly configured', () => {
    renderChat()
    expect(
      screen.queryByRole('button', { name: 'common.fileUploader.uploadFromComputer' }),
    ).not.toBeInTheDocument()
  })

  it('sends an uploaded document in Build even when the selected model has no vision capability', async () => {
    const user = userEvent.setup()
    renderChat({
      mode: 'build',
      agentSoulConfig: {
        schema_version: 1,
        app_features: {
          file_upload: {
            enabled: true,
            allowed_file_types: ['document'],
            allowed_file_upload_methods: ['remote_url'],
            number_limits: 3,
          },
        },
      },
    })
    await user.click(screen.getByRole('button', { name: 'common.fileUploader.uploadFromComputer' }))
    await user.type(
      screen.getByPlaceholderText('common.fileUploader.pasteFileLinkInputPlaceholder'),
      'https://example.com/brief.docx',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
    expect(await screen.findByText('https://example.com/brief.docx')).toBeVisible()
    await send(user, 'Read the document')
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    expect(ssePost.mock.calls[0]?.[1].body).toMatchObject({
      query: 'Read the document',
      files: [
        expect.objectContaining({
          type: 'document',
          transfer_method: 'remote_url',
          url: 'https://example.com/brief.docx',
        }),
      ],
    })
  })

  it.each(['COMMUNITY', 'CLOUD'] as const)(
    'shows the sandbox notice in %s until sending, with extra information only in Community',
    async (edition) => {
      const user = userEvent.setup()
      renderChat({ edition })
      expect(screen.getByText(`${prefix}.preview.sandboxNotice`)).toBeVisible()
      const info = screen.queryByRole('button', { name: `${prefix}.preview.sandboxNotice` })
      if (edition === 'COMMUNITY') expect(info).toBeVisible()
      else expect(info).not.toBeInTheDocument()
      await send(user)
      await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
      expect(screen.queryByText(`${prefix}.preview.sandboxNotice`)).not.toBeInTheDocument()
    },
  )

  it.each(['preview', 'build'] as const)('warns about an unconfigured agent in %s', (mode) => {
    renderChat({ mode, draft: { prompt: '' } })
    expect(screen.getByText(`${prefix}.preview.unconfiguredNotice`)).toBeVisible()
  })

  it.each([
    ['prompt', { prompt: 'You are helpful.' }],
    ['build note', { configNote: 'Use the latest build context.' }],
    ['skill', { skills: [{ id: 'skill-1', name: 'Research' }] }],
    ['knowledge base', { knowledgeRetrievals: [{ id: 'retrieval-1', name: 'Docs' }] }],
    ['file', { files: [{ id: 'brief.md', icon: 'markdown' as const, name: 'brief.md' }] }],
    ['tool', { tools: [{ id: 'cli-1', kind: 'cli' as const, name: 'CLI' }] }],
    [
      'environment variable',
      {
        envVariables: [{ id: 'env-1', key: 'API_KEY', scope: 'secret' as const, value: 'secret' }],
      },
    ],
  ] satisfies Array<[string, Partial<AgentSoulConfigFormState>]>)(
    'hides the unconfigured warning when a %s is present',
    (_kind, draft) => {
      renderChat({ draft: { prompt: '', ...draft } })
      expect(screen.getByText(`${prefix}.preview.unconfiguredNotice`)).not.toBeVisible()
    },
  )
})

describe('Agent stop and failure ownership', () => {
  it('stops thought-only execution, preserves its task across empty deltas, and never reuses it next turn', async () => {
    const user = userEvent.setup()
    renderChat()
    await send(user)
    await waitFor(() => expect(ssePost).toHaveBeenCalledOnce())
    await act(async () => {
      stream().onThought?.({
        id: 'thought',
        task_id: 'task-thought',
        conversation_id: 'conversation-1',
        message_id: 'message-0',
        thought: 'Working',
        tool: '',
        tool_input: '',
        observation: '',
        position: 1,
      })
      stream().onData?.('', false, { messageId: '' })
    })
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.stopResponding' }))
    await waitFor(() => expect(abortControllers[0]?.signal.aborted).toBe(true))
    expect(api.stop).toHaveBeenCalledExactlyOnceWith(
      {
        params: { agent_id: 'agent-1', task_id: 'task-thought' },
      },
      { context: { silent: true } },
    )
    await send(user, 'Next turn')
    await waitFor(() => expect(ssePost).toHaveBeenCalledTimes(2))
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.stopResponding' }))
    expect(api.stop).toHaveBeenCalledOnce()
    expect(abortControllers[1]?.signal.aborted).toBe(false)
    expect(api.error).toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'appDebug.operation.stopResponding' }),
    ).toBeInTheDocument()
  })

  it('keeps the stream active after a rejected stop and allows retrying', async () => {
    const user = userEvent.setup()
    api.stop.mockRejectedValueOnce(new Error('Forbidden'))
    renderChat()
    await send(user)
    await receive()
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.stopResponding' }))
    await waitFor(() => expect(api.error).toHaveBeenCalled())
    expect(abortControllers[0]?.signal.aborted).toBe(false)
    await user.click(screen.getByRole('button', { name: 'appDebug.operation.stopResponding' }))
    await waitFor(() => expect(abortControllers[0]?.signal.aborted).toBe(true))
    expect(api.stop).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['', 'Partial answer'])(
    'retains a safe error alongside %s through history reload',
    async (answer) => {
      const user = userEvent.setup()
      const view = renderChat()
      await send(user)
      await receive(0, answer)
      messages.set('conversation-1', [
        createMessage({ answer, status: 'error', error: 'SECRET provider detail' }),
      ])
      await act(async () => {
        stream().onError?.('SECRET provider detail')
        await stream().onCompleted?.(true)
      })
      expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
      expect(screen.queryByText('SECRET provider detail')).not.toBeInTheDocument()
      if (answer) expect(await screen.findByText(answer)).toBeInTheDocument()
      view.unmount()
      renderChat({ conversationId: 'conversation-1' })
      expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
      expect(screen.queryByText('SECRET provider detail')).not.toBeInTheDocument()
    },
  )
})

it.each(['sse', 'http'])(
  'renders a persistent safe error from the real %s transport',
  async (transport) => {
    const actual = await vi.importActual<typeof import('@/service/base')>('@/service/base')
    ssePost.mockImplementation(actual.ssePost)
    const payload = {
      event: 'error',
      message: 'SECRET provider details',
      code: 'agent_run_failed',
      conversation_id: 'conversation-1',
      message_id: 'message-0',
    }
    const response =
      transport === 'http'
        ? Response.json(payload, { status: 500 })
        : new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n`))
                controller.close()
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } },
          )
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    try {
      const user = userEvent.setup()
      renderChat()
      await send(user)
      expect(await screen.findByRole('alert')).toHaveTextContent('common.api.actionFailed')
      expect(screen.queryByText('SECRET provider details')).not.toBeInTheDocument()
      expect(api.error).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('button', { name: 'appDebug.operation.stopResponding' }),
      ).not.toBeInTheDocument()
      if (transport === 'sse')
        await waitFor(() =>
          expect(api.history).toHaveBeenCalledWith(
            expect.objectContaining({ query: { conversation_id: 'conversation-1' } }),
          ),
        )
    } finally {
      fetch.mockRestore()
    }
  },
)
