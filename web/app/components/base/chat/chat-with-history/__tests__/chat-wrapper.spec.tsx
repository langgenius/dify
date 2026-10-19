import type { ChatItemInTree } from '../../types'
import type { ChatWithHistoryContextValue } from '../context'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { AppData } from '@/models/share'
import type { WorkflowFinishedResponse, WorkflowPausedResponse } from '@/types/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { registerWebAppEventTracker } from '@/app/components/base/amplitude/web-app-event'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
import {
  fetchChatList,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
  submitHumanInputForm,
} from '@/service/share'
import { submitHumanInputForm as submitInstalledForm } from '@/service/workflow'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture, createChatFileFixture } from '@/test/fixtures/chat'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import ChatWrapper from '../chat-wrapper'
import { ChatWithHistoryContext } from '../context'

const { sseGet, ssePost } = vi.hoisted(() => ({
  sseGet: vi.fn<typeof import('@/service/base').sseGet>(),
  ssePost: vi.fn<typeof import('@/service/base').ssePost>(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: 'test-token' }),
}))

vi.mock('@/service/base', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/base')>()
  return {
    ...actual,
    sseGet,
    ssePost,
  }
})

vi.mock('@/service/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/share')>()
  return {
    ...actual,
    fetchChatList: vi.fn<typeof actual.fetchChatList>(),
    fetchSuggestedQuestions: vi.fn<typeof actual.fetchSuggestedQuestions>(),
    stopChatMessageResponding: vi.fn<typeof actual.stopChatMessageResponding>(),
    submitHumanInputForm: vi.fn<typeof actual.submitHumanInputForm>(),
  }
})

vi.mock('@/service/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/workflow')>()
  return { ...actual, submitHumanInputForm: vi.fn<typeof actual.submitHumanInputForm>() }
})

const createAppData = (overrides: Partial<AppData> = {}): AppData => ({
  app_id: 'test-app-id',
  mode: 'advanced-chat',
  custom_config: null,
  site: {
    title: 'Test Chat',
    icon_type: 'image',
    icon: 'test-icon',
    icon_url: 'https://example.com/icon.png',
  },
  ...overrides,
})

const createHistoryContextValue = (
  overrides: Partial<ChatWithHistoryContextValue> = {},
): ChatWithHistoryContextValue => ({
  appData: createAppData(),
  appMeta: { tool_icons: {} },
  appParams: createChatConfigFixture({ questionEditEnable: true }),
  currentConversationId: '1',
  currentConversationItem: { id: '1', name: 'Conversation', inputs: {}, introduction: '' },
  appPrevChatTree: [],
  newConversationInputs: {},
  newConversationInputsRef: { current: overrides.newConversationInputs ?? {} },
  inputsForms: [],
  isInstalledApp: false,
  currentChatInstanceRef: { current: { handleStop: vi.fn() } },
  setIsResponding: vi.fn(),
  setClearChatList: vi.fn(),
  conversationList: [],
  sidebarCollapseState: false,
  handleSidebarCollapse: vi.fn(),
  handlePinConversation: vi.fn(),
  handleUnpinConversation: vi.fn(),
  handleDeleteConversation: vi.fn(),
  conversationRenaming: false,
  handleRenameConversation: vi.fn(),
  handleNewConversation: vi.fn(),
  handleNewConversationInputsChange: vi.fn(),
  handleStartChat: (callback) => callback?.(),
  handleChangeConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  handleFeedback: vi.fn().mockResolvedValue(undefined),
  pinnedConversationList: [],
  chatShouldReloadKey: '',
  isMobile: false,
  currentConversationInputs: {},
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  appId: 'test-app-id',
  ...overrides,
})

function renderChat(overrides: Partial<ChatWithHistoryContextValue> = {}) {
  let context = createHistoryContextValue(overrides)
  const tree = () => (
    <ChatWithHistoryContext.Provider value={context}>
      <ChatWrapper />
    </ChatWithHistoryContext.Provider>
  )
  const view = renderWithConsoleQuery(tree())
  return {
    ...view,
    context,
    updateContext: (next: Partial<ChatWithHistoryContextValue>) => {
      context = { ...context, ...next }
      view.rerender(tree())
    },
  }
}

const chatInput = () => screen.getByPlaceholderText(/common.chat.inputPlaceholder/)
const stream = () => vi.mocked(ssePost).mock.lastCall![2]
const events = () => vi.mocked(sseGet).mock.lastCall![2]
const sendMessage = async (user: ReturnType<typeof userEvent.setup>, message = 'Hello') => {
  await user.type(chatInput(), message)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(ssePost).toHaveBeenCalled())
}

const question = (
  id: string,
  content: string,
  answerId: string,
  answer: string,
  siblingIndex = 0,
): ChatItemInTree => ({
  id,
  content,
  isAnswer: false,
  children: [{ id: answerId, content: answer, isAnswer: true, parentMessageId: id, siblingIndex }],
})
const uploadedFile = (id = 'file-1', uploadedId?: string): FileEntity =>
  createChatFileFixture({
    id,
    progress: uploadedId ? 100 : 30,
    uploadedId,
  })

const pausedAnswer = (id = 'paused-answer', runId = 'workflow-1'): ChatItemInTree => ({
  id,
  isAnswer: true,
  content: '',
  siblingIndex: 0,
  workflow_run_id: runId,
  workflowProcess: createWorkflowProcessFixture({ status: WorkflowRunningStatus.Paused }),
  humanInputFormDataList: [
    createHumanInputFormFixture({
      node_title: 'Approval',
      form_content: '{{#$output.review#}}',
      inputs: [
        {
          type: InputVarType.paragraph,
          output_variable_name: 'review',
          default: { type: 'constant', value: '', selector: [] },
        },
      ],
      actions: [{ id: 'approve', title: 'Approve', button_style: 'primary' }],
    }),
  ],
})
const pausedEvent = (runId = 'workflow-1'): WorkflowPausedResponse => ({
  event: 'workflow_paused',
  task_id: 'task-1',
  workflow_run_id: runId,
  data: { workflow_run_id: runId, paused_nodes: ['human-input-1'], reasons: [], outputs: {} },
})
const finishedEvent = (runId = 'workflow-1'): WorkflowFinishedResponse => ({
  event: 'workflow_finished',
  task_id: 'task-1',
  workflow_run_id: runId,
  data: {
    id: runId,
    workflow_id: 'workflow',
    status: 'succeeded',
    outputs: {},
    error: '',
    elapsed_time: 1,
    total_tokens: 10,
    total_steps: 1,
    created_at: 1,
    finished_at: 2,
    created_by: { id: 'user-1', name: 'User', email: 'user@example.com' },
  },
})

const trackEvent = vi.fn()
let unregisterTracker: () => void
beforeEach(() => {
  vi.mocked(ssePost).mockReset().mockResolvedValue(undefined)
  vi.mocked(sseGet).mockReset().mockResolvedValue(undefined)
  vi.mocked(fetchChatList).mockReset().mockResolvedValue({ data: [] })
  vi.mocked(fetchSuggestedQuestions)
    .mockReset()
    .mockResolvedValue({ data: ['Next question'] })
  vi.mocked(stopChatMessageResponding).mockReset().mockResolvedValue({})
  vi.mocked(submitHumanInputForm).mockReset().mockResolvedValue({})
  vi.mocked(submitInstalledForm).mockReset().mockResolvedValue({})
  unregisterTracker = registerWebAppEventTracker(trackEvent)
})
afterEach(() => unregisterTracker())

it('sends an opening suggestion and keeps one opening statement in the conversation', async () => {
  const user = userEvent.setup()
  const { context } = renderChat({
    currentConversationId: '',
    appParams: createChatConfigFixture({
      opening_statement: 'Welcome',
      suggested_questions: ['Ask something'],
    }),
  })
  expect(await screen.findByText('Welcome')).toBeVisible()
  await user.click(screen.getByText('Ask something'))
  await waitFor(() =>
    expect(ssePost).toHaveBeenCalledWith(
      'chat-messages',
      {
        body: expect.objectContaining({
          query: 'Ask something',
          parent_message_id: null,
          conversation_id: '',
          response_mode: 'streaming',
        }),
      },
      expect.objectContaining({ isPublicAPI: true }),
    ),
  )
  expect(screen.getAllByText('Welcome')).toHaveLength(1)
  expect(context.setIsResponding).toHaveBeenLastCalledWith(true)
  await act(async () => {
    stream().onData?.('Hello back', true, {
      messageId: 'answer-1',
      taskId: 'task-1',
      conversationId: 'new-conversation',
    })
    await stream().onCompleted?.()
  })
  expect(screen.getByText('Hello back')).toBeVisible()
  expect(context.setIsResponding).toHaveBeenLastCalledWith(false)
  expect(context.handleNewConversationCompleted).toHaveBeenCalledWith('new-conversation', undefined)
})

it.each([undefined, '', 'Conversation introduction'])(
  'renders the selected opening statement for introduction %s',
  async (introduction) => {
    renderChat({
      currentConversationId: '',
      currentConversationItem:
        introduction === undefined
          ? undefined
          : { id: '1', name: 'Conversation', inputs: {}, introduction },
      appParams: createChatConfigFixture({ opening_statement: 'Default opening statement' }),
    })
    expect(await screen.findByText(introduction || 'Default opening statement')).toBeVisible()
  },
)

it.each(['button', 'chat instance'] as const)(
  'stops the current response through the %s',
  async (action) => {
    const user = userEvent.setup()
    const { context } = renderChat()
    await sendMessage(user)
    const controller = new AbortController()
    act(() => {
      stream().getAbortController?.(controller)
      stream().onData?.('Thinking', true, { messageId: 'a1', taskId: 'task-123' })
    })
    if (action === 'button')
      await user.click(screen.getByRole('button', { name: /appDebug.operation.stopResponding/i }))
    else act(() => context.currentChatInstanceRef.current.handleStop())
    expect(stopChatMessageResponding).toHaveBeenCalledExactlyOnceWith(
      '',
      'task-123',
      'webApp',
      'test-app-id',
    )
    expect(controller.signal.aborted).toBe(true)
    expect(context.setIsResponding).toHaveBeenLastCalledWith(false)
  },
)

it.each([
  {
    name: 'missing required text',
    type: InputVarType.textInput,
    value: '',
    required: true,
    disabled: true,
  },
  {
    name: 'provided text',
    type: InputVarType.textInput,
    value: 'value',
    required: true,
    disabled: false,
  },
  { name: 'zero number', type: InputVarType.number, value: 0, required: true, disabled: false },
  {
    name: 'optional text',
    type: InputVarType.textInput,
    value: '',
    required: false,
    disabled: false,
  },
  {
    name: 'unchecked checkbox',
    type: InputVarType.checkbox,
    value: false,
    required: true,
    disabled: false,
  },
  {
    name: 'uploading file',
    type: InputVarType.singleFile,
    value: uploadedFile(),
    required: true,
    disabled: true,
  },
  {
    name: 'uploaded file',
    type: InputVarType.singleFile,
    value: uploadedFile('1', 'uploaded-1'),
    required: true,
    disabled: false,
  },
  {
    name: 'mixed uploads',
    type: InputVarType.multiFiles,
    value: [uploadedFile('1', 'uploaded-1'), uploadedFile('2')],
    required: true,
    disabled: true,
  },
  {
    name: 'completed uploads',
    type: InputVarType.multiFiles,
    value: [uploadedFile('1', 'uploaded-1'), uploadedFile('2', 'uploaded-2')],
    required: true,
    disabled: false,
  },
])('gates the composer for $name', async ({ type, value, required, disabled }) => {
  const user = userEvent.setup()
  renderChat({
    currentConversationId: '',
    inputsForms: [{ variable: 'input', label: 'Input', type, required }],
    newConversationInputs: { input: value },
    newConversationInputsRef: { current: { input: value } },
  })
  expect(chatInput()).toHaveProperty('disabled', disabled)
  if (disabled) {
    await user.type(chatInput(), 'blocked{Enter}')
    expect(ssePost).not.toHaveBeenCalled()
  }
})

it('keeps the composer enabled when variable inputs are hidden', () => {
  renderChat({
    currentConversationId: '',
    allInputsHidden: true,
    inputsForms: [
      { variable: 'req', label: 'Required', type: InputVarType.textInput, required: true },
    ],
  })
  expect(chatInput()).toBeEnabled()
})

it.each([
  { isNewAgent: true, mode: 'agent-v2' },
  { isNewAgent: false, mode: 'advanced-chat' },
])(
  'tracks $mode sends and refreshes agent history only when required',
  async ({ isNewAgent, mode }) => {
    const user = userEvent.setup()
    renderChat({ currentConversationId: '', isNewAgent })
    await sendMessage(user)
    expect(trackEvent).toHaveBeenCalledExactlyOnceWith('webapp_run', { app_mode: mode })
    await act(async () => {
      stream().onData?.('Answer', true, {
        messageId: 'a1',
        conversationId: 'new-conversation',
        event: 'message',
      })
      await stream().onCompleted?.()
    })
    if (isNewAgent)
      expect(fetchChatList).toHaveBeenCalledExactlyOnceWith(
        'new-conversation',
        'webApp',
        'test-app-id',
      )
    else expect(fetchChatList).not.toHaveBeenCalled()
  },
)

it('uses the installed-app send endpoint without web-app tracking', async () => {
  const user = userEvent.setup()
  renderChat({ isInstalledApp: true })
  await sendMessage(user)
  expect(ssePost).toHaveBeenCalledWith(
    'installed-apps/test-app-id/chat-messages',
    expect.any(Object),
    expect.objectContaining({ isPublicAPI: false }),
  )
  expect(trackEvent).not.toHaveBeenCalled()
})

it.each(['', 'existing-conversation'])(
  'notifies conversation creation only for a new conversation (%s)',
  async (conversationId) => {
    const user = userEvent.setup()
    const { context } = renderChat({ currentConversationId: conversationId })
    await sendMessage(user)
    await act(async () => {
      stream().onData?.('Answer', true, { messageId: 'a1', conversationId: 'server-conversation' })
      await stream().onCompleted?.()
    })
    if (conversationId) expect(context.handleNewConversationCompleted).not.toHaveBeenCalled()
    else
      expect(context.handleNewConversationCompleted).toHaveBeenCalledExactlyOnceWith(
        'server-conversation',
        undefined,
      )
  },
)

it('shows suggested follow-ups after the server completes the answer', async () => {
  const user = userEvent.setup()
  renderChat({
    appParams: createChatConfigFixture({ suggested_questions_after_answer: { enabled: true } }),
  })
  await sendMessage(user)
  await act(async () => {
    stream().onData?.('Answer', true, { messageId: 'response-id' })
    await stream().onCompleted?.()
  })
  expect(fetchSuggestedQuestions).toHaveBeenCalledExactlyOnceWith(
    'response-id',
    'webApp',
    'test-app-id',
  )
  expect(await screen.findByText('Next question')).toBeVisible()
})

it('uses saved conversation inputs instead of the new conversation draft', async () => {
  const user = userEvent.setup()
  renderChat({
    currentConversationId: '123',
    currentConversationInputs: { test: 'saved' },
    newConversationInputs: { test: 'draft' },
  })
  await sendMessage(user, 'New message')
  expect(ssePost).toHaveBeenCalledWith(
    'chat-messages',
    {
      body: expect.objectContaining({
        inputs: { test: 'saved' },
        query: 'New message',
        conversation_id: '123',
      }),
    },
    expect.any(Object),
  )
})

it.each([true, false])(
  'sends checkbox value %s without adding unrelated input keys',
  async (agree) => {
    const user = userEvent.setup()
    renderChat({
      currentConversationId: '',
      inputsForms: [
        { variable: 'test', label: 'Text', type: InputVarType.textInput, required: false },
        { variable: 'agree', label: 'Agree', type: InputVarType.checkbox, required: false },
      ],
      newConversationInputs: { test: 'value', agree },
    })
    await sendMessage(user)
    expect(ssePost).toHaveBeenCalledWith(
      'chat-messages',
      { body: expect.objectContaining({ inputs: { test: 'value', agree } }) },
      expect.any(Object),
    )
  },
)

it('regenerates a follow-up using its preceding answer as the parent', async () => {
  const user = userEvent.setup()
  const nextQuestion = question('q1', 'Question to regenerate', 'a1', 'Answer to regenerate')
  nextQuestion.parentMessageId = 'a0'
  renderChat({
    appPrevChatTree: [
      {
        id: 'root-question',
        isAnswer: false,
        content: 'Earlier question',
        children: [
          {
            id: 'a0',
            isAnswer: true,
            content: 'Parent message',
            siblingIndex: 0,
            children: [nextQuestion],
          },
        ],
      },
    ],
  })
  await user.click(screen.getAllByRole('button', { name: 'common.operation.regenerate' }).at(-1)!)
  await waitFor(() =>
    expect(ssePost).toHaveBeenCalledWith(
      'chat-messages',
      {
        body: expect.objectContaining({
          query: 'Question to regenerate',
          parent_message_id: 'a0',
        }),
      },
      expect.any(Object),
    ),
  )
})

it('regenerates an edited question with its uploaded file', async () => {
  const user = userEvent.setup()
  const file = uploadedFile('file-q1', 'upload-q1')
  renderChat({
    appPrevChatTree: [
      { ...question('q1', 'Original question', 'a1', 'Answer'), message_files: [file] },
    ],
  })
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  const edited = await screen.findByDisplayValue('Original question')
  await user.clear(edited)
  await user.type(edited, 'Edited question text')
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(ssePost).toHaveBeenCalledWith(
      'chat-messages',
      {
        body: expect.objectContaining({
          query: 'Edited question text',
          parent_message_id: null,
          files: [
            expect.objectContaining({ upload_file_id: 'upload-q1', transfer_method: 'local_file' }),
          ],
        }),
      },
      expect.any(Object),
    ),
  )
})

it('switches the visible answer branch using the real history tree', async () => {
  const user = userEvent.setup()
  renderChat({
    appPrevChatTree: [
      question('q1', 'Original question', 'a1', 'Original answer'),
      question('q2', 'Revised question', 'a2', 'Revised answer', 1),
    ],
  })
  expect(screen.getByText('Revised answer')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Previous' }))
  expect(await screen.findByText('Original answer')).toBeVisible()
  expect(screen.queryByText('Revised answer')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Revised answer')).toBeVisible()
})

it('resumes the deepest paused descendant, leaving the ancestor subscription unopened', () => {
  const descendant = pausedAnswer('descendant', 'descendant-run')
  const ancestor: ChatItemInTree = {
    ...pausedAnswer('ancestor', 'ancestor-run'),
    children: [{ id: 'q2', isAnswer: false, content: 'Continue', children: [descendant] }],
  }
  renderChat({
    appPrevChatTree: [{ id: 'q1', isAnswer: false, content: 'Question', children: [ancestor] }],
  })
  expect(sseGet).toHaveBeenCalledExactlyOnceWith(
    '/workflow/descendant-run/events?include_state_snapshot=true&continue_on_pause=true',
    {},
    expect.objectContaining({ isPublicAPI: true }),
  )
})

it('resumes an active workflow when history arrives after the chat wrapper mounts', async () => {
  const { updateContext } = renderChat({ appPrevChatTree: [] })

  updateContext({
    appPrevChatTree: [
      {
        ...question('q1', 'Question', 'a1', ''),
        children: [
          {
            id: 'a1',
            content: '',
            isAnswer: true,
            parentMessageId: 'q1',
            workflow_run_id: 'active-run',
            workflow_run_is_running: true,
          },
        ],
      },
    ],
  })

  await waitFor(() =>
    expect(sseGet).toHaveBeenCalledExactlyOnceWith(
      '/workflow/active-run/events?include_state_snapshot=true&continue_on_pause=true',
      {},
      expect.objectContaining({ isPublicAPI: true }),
    ),
  )
})

it('does not open a workflow event stream for completed history', () => {
  renderChat({
    appPrevChatTree: [
      {
        ...question('q1', 'Question', 'a1', 'Answer'),
        children: [
          {
            id: 'a1',
            content: 'Answer',
            isAnswer: true,
            parentMessageId: 'q1',
            workflow_run_id: 'completed-run',
            workflow_run_is_running: false,
          },
        ],
      },
    ],
  })
  expect(screen.getByText('Answer')).toBeVisible()
  expect(sseGet).not.toHaveBeenCalled()
})

it.each(['', 'existing-conversation'])(
  'completes a resumed workflow with the correct conversation callback (%s)',
  async (conversationId) => {
    const { context } = renderChat({
      currentConversationId: conversationId,
      appParams: createChatConfigFixture({ suggested_questions_after_answer: { enabled: true } }),
      appPrevChatTree: [
        { id: 'q1', isAnswer: false, content: 'Question', children: [pausedAnswer()] },
      ],
    })
    await act(async () => {
      events().onData?.('Resumed answer', true, {
        messageId: 'paused-answer',
        conversationId: 'resumed-conversation',
      })
      events().onWorkflowFinished?.(finishedEvent())
      await events().onCompleted?.()
    })
    expect(screen.getByText('Resumed answer')).toBeVisible()
    expect(fetchSuggestedQuestions).toHaveBeenCalledExactlyOnceWith(
      'paused-answer',
      'webApp',
      'test-app-id',
    )
    if (conversationId) expect(context.handleNewConversationCompleted).not.toHaveBeenCalled()
    else
      expect(context.handleNewConversationCompleted).toHaveBeenCalledExactlyOnceWith(
        'resumed-conversation',
        'workflow-1',
      )
  },
)

it.each([false, true])(
  'waits for the workflow subscription before submitting human input (installed=%s)',
  async (isInstalledApp) => {
    const user = userEvent.setup()
    renderChat({
      isInstalledApp,
      appPrevChatTree: [
        { id: 'q1', isAnswer: false, content: 'Question', children: [pausedAnswer()] },
      ],
    })
    expect(chatInput()).toBeDisabled()
    await user.type(await screen.findByRole('textbox', { name: 'review' }), 'Approved')
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(submitHumanInputForm).not.toHaveBeenCalled()
    expect(submitInstalledForm).not.toHaveBeenCalled()
    await act(async () => {
      events().onWorkflowPaused?.(pausedEvent())
    })
    const submit = isInstalledApp ? submitInstalledForm : submitHumanInputForm
    const otherSubmit = isInstalledApp ? submitHumanInputForm : submitInstalledForm
    await waitFor(() =>
      expect(submit).toHaveBeenCalledExactlyOnceWith('token-1', {
        inputs: { review: 'Approved' },
        action: 'approve',
      }),
    )
    expect(otherSubmit).not.toHaveBeenCalled()
  },
)

it('does not submit human input when the workflow event connection fails before becoming ready', async () => {
  const user = userEvent.setup()
  renderChat({
    appPrevChatTree: [
      { id: 'q1', isAnswer: false, content: 'Question', children: [pausedAnswer()] },
    ],
  })
  await user.type(await screen.findByRole('textbox', { name: 'review' }), 'Approved')
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  await act(async () => {
    events().onError?.('Connection lost')
  })
  expect(submitHumanInputForm).not.toHaveBeenCalled()
})

it.each([false, true])(
  'shows inputs before the welcome and reveals it after starting chat (mobile=%s)',
  async (isMobile) => {
    const user = userEvent.setup()
    renderChat({
      currentConversationId: '',
      isMobile,
      appParams: createChatConfigFixture({ opening_statement: 'Welcome' }),
      inputsForms: [
        { variable: 'test', label: 'Test', type: InputVarType.textInput, required: false },
      ],
    })
    expect(screen.getByText('Test')).toBeVisible()
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'share.chat.startChat' }))
    expect(await screen.findByText('Welcome')).toBeVisible()
  },
)

it('hides the mobile variable form after entering an existing conversation', () => {
  const { updateContext } = renderChat({
    currentConversationId: '',
    isMobile: true,
    inputsForms: [
      { variable: 'test', label: 'Test', type: InputVarType.textInput, required: false },
    ],
  })
  expect(screen.getByText('Test')).toBeVisible()
  updateContext({ currentConversationId: '123' })
  expect(screen.queryByText('Test')).not.toBeInTheDocument()
})

it('shows the configured app image for historical answers', () => {
  const appData = createAppData()
  appData.site.use_icon_as_answer_icon = true
  renderChat({ appData, appPrevChatTree: [question('q1', 'Question', 'a1', 'Answer')] })
  expect(screen.getByAltText('answer icon')).toHaveAttribute('src', appData.site.icon_url)
})

it.each([
  { name: 'John Doe', label: 'John Doe', initial: 'J' },
  { name: undefined, label: 'user', initial: 'U' },
])('labels the user avatar and its fallback as $label', ({ name, label, initial }) => {
  renderChat({
    appData: null,
    appMeta: null,
    initUserVariables: { avatar_url: 'https://example.com/avatar.png', name },
    appPrevChatTree: [question('q1', 'Question', 'a1', 'Answer')],
  })
  expect(screen.getByRole('img', { name: label })).toHaveTextContent(initial)
})
