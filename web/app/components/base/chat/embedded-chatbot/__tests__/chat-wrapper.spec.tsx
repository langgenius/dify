import type { ChatItemInTree } from '../../types'
import type { EmbeddedChatbotContextValue } from '../context'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vite-plus/test'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
// oxlint-disable-next-line no-restricted-imports -- Exercise the existing chat SSE transport at its network boundary.
import { sseGet, ssePost } from '@/service/base'
import {
  AppSourceType,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
  submitHumanInputForm,
} from '@/service/share'
import { submitHumanInputForm as submitInstalledHumanInput } from '@/service/workflow'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture, createChatFileFixture } from '@/test/fixtures/chat'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ChatWrapper from '../chat-wrapper'
import { EmbeddedChatbotContext } from '../context'

// oxlint-disable-next-line typescript/no-deprecated -- Existing SSE transport boundary; no new API is introduced.
const post = vi.mocked(ssePost)
// oxlint-disable-next-line typescript/no-deprecated -- Existing workflow event transport boundary.
const get = vi.mocked(sseGet)
const ContextProvider = EmbeddedChatbotContext.Provider

vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'share-code' }),
  usePathname: () => '/chat/share-code',
}))
vi.mock('@/app/components/base/amplitude/web-app-event', () => ({ trackWebAppEvent: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  ssePost: vi.fn(),
  sseGet: vi.fn(),
}))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  fetchSuggestedQuestions: vi.fn().mockResolvedValue({ data: ['Tell me more'] }),
  stopChatMessageResponding: vi.fn().mockResolvedValue(undefined),
  submitHumanInputForm: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: vi.fn().mockResolvedValue(undefined),
}))

const answer = (
  id: string,
  content: string,
  overrides: Partial<ChatItemInTree> = {},
): ChatItemInTree => ({
  id,
  content,
  isAnswer: true,
  children: [],
  ...overrides,
})
const question = (id: string, content: string, child: ChatItemInTree): ChatItemInTree => ({
  id,
  content,
  isAnswer: false,
  children: [{ ...child, parentMessageId: id }],
})
const history = (): ChatItemInTree[] => [
  question(
    'prior-question',
    'Previous question',
    answer('prior-answer', 'Previous answer', {
      children: [
        {
          ...question('question-1', 'Original question', answer('answer-1', 'Original answer')),
          parentMessageId: 'prior-answer',
        },
      ],
    }),
  ),
]
const pausedAnswer = (id = 'paused-answer', runId = 'run-1'): ChatItemInTree =>
  answer(id, '', {
    workflow_run_id: runId,
    workflowProcess: createWorkflowProcessFixture({ status: WorkflowRunningStatus.Paused }),
    humanInputFormDataList: [
      createHumanInputFormFixture({
        form_id: `form-${id}`,
        node_id: 'human-input',
        node_title: 'Approval',
        actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
        form_token: 'form-token',
      }),
    ],
  })

function renderSubject(overrides: Partial<EmbeddedChatbotContextValue> = {}) {
  const context = createEmbeddedChatbotContextFixture({
    appId: 'app-1',
    appData: {
      app_id: 'app-1',
      mode: 'chat',
      custom_config: null,
      site: {
        title: 'Embedded App',
        icon_type: 'emoji',
        icon: '🤖',
        input_placeholder: 'Ask the assistant',
      },
    },
    appMeta: { tool_icons: {} },
    appParams: createChatConfigFixture({ questionEditEnable: true }),
    ...overrides,
  })
  const view = renderWithConsoleQuery(
    <ContextProvider value={context}>
      <ChatWrapper />
    </ContextProvider>,
  )
  return {
    ...view,
    context,
    user: userEvent.setup(),
    updateContext: (changes: Partial<EmbeddedChatbotContextValue>) =>
      view.rerender(
        <ContextProvider value={{ ...context, ...changes }}>
          <ChatWrapper />
        </ContextProvider>,
      ),
  }
}

async function completeReply(content = 'Streamed answer', index = 0) {
  const callbacks = post.mock.calls[index]![2]
  await act(async () => {
    callbacks.onData?.(content, true, {
      conversationId: 'created-conversation',
      messageId: `response-${index}`,
      taskId: `task-${index}`,
    })
    await callbacks.onCompleted?.()
  })
}

function confirmPaused() {
  const callbacks = get.mock.calls[0]![2]
  act(() =>
    callbacks.onWorkflowPaused?.({
      task_id: 'task-1',
      workflow_run_id: 'run-1',
      event: 'workflow_paused',
      data: { workflow_run_id: 'run-1', outputs: {}, paused_nodes: ['human-input'], reasons: [] },
    }),
  )
}

describe('Embedded chatbot orchestration', () => {
  beforeEach(() => {
    const stopGuard = guardUnexpectedFetch()
    onTestFinished(stopGuard)
  })

  it.each([
    [InputVarType.textInput, '', true],
    [InputVarType.textInput, 'Ada', false],
    [InputVarType.number, 0, false],
    [InputVarType.checkbox, false, false],
    [InputVarType.multiFiles, [], true],
    [
      InputVarType.multiFiles,
      [createChatFileFixture({ uploadedId: undefined, progress: 0 })],
      true,
    ],
    [InputVarType.multiFiles, [createChatFileFixture()], false],
    [InputVarType.singleFile, createChatFileFixture({ uploadedId: undefined, progress: 0 }), true],
    [InputVarType.singleFile, createChatFileFixture(), false],
  ])('enforces required %s input readiness for %j', (type, value, disabled) => {
    renderSubject({
      inputsForms: [{ variable: 'value', label: 'Value', required: true, type }],
      newConversationInputs: { value },
      newConversationInputsRef: { current: { value } },
    })
    const input = screen.getByPlaceholderText('Ask the assistant')
    if (disabled) expect(input).toBeDisabled()
    else expect(input).toBeEnabled()
  })

  it('uses saved conversation inputs and the last answer when sending', async () => {
    const { user } = renderSubject({
      currentConversationId: 'conversation-1',
      currentConversationInputs: { topic: 'saved' },
      newConversationInputs: { topic: 'new' },
      inputsForms: [
        { variable: 'topic', label: 'Topic', required: true, type: InputVarType.textInput },
      ],
      appPrevChatList: [question('last-question', 'Question', answer('last-answer', 'Answer'))],
    })
    await user.type(screen.getByPlaceholderText('Ask the assistant'), 'hello world{Enter}')
    expect(post).toHaveBeenCalledExactlyOnceWith(
      'chat-messages',
      {
        body: {
          query: 'hello world',
          files: [],
          inputs: { topic: 'saved' },
          conversation_id: 'conversation-1',
          parent_message_id: 'last-answer',
          response_mode: 'streaming',
        },
      },
      expect.objectContaining({ isPublicAPI: true }),
    )
    await completeReply()
    expect(await screen.findByText('Streamed answer')).toBeInTheDocument()
  })

  it('completes a new conversation and displays suggested questions', async () => {
    const completed = vi.fn()
    const { user } = renderSubject({
      newConversationInputs: { topic: 'new' },
      newConversationInputsRef: { current: { topic: 'new' } },
      inputsForms: [
        { variable: 'topic', label: 'Topic', required: false, type: InputVarType.textInput },
      ],
      appParams: createChatConfigFixture({ suggested_questions_after_answer: { enabled: true } }),
      handleNewConversationCompleted: completed,
    })
    await user.type(screen.getByPlaceholderText('Ask the assistant'), 'hello world{Enter}')
    expect(post).toHaveBeenCalledWith(
      'chat-messages',
      {
        body: {
          query: 'hello world',
          files: [],
          inputs: { topic: 'new' },
          conversation_id: '',
          parent_message_id: null,
          response_mode: 'streaming',
        },
      },
      expect.objectContaining({ isPublicAPI: true }),
    )
    await completeReply()
    expect(completed).toHaveBeenCalledExactlyOnceWith('created-conversation', undefined)
    expect(fetchSuggestedQuestions).toHaveBeenCalledExactlyOnceWith(
      'response-0',
      AppSourceType.webApp,
      'app-1',
    )
    expect(await screen.findByRole('button', { name: 'Tell me more' })).toBeInTheDocument()
  })

  it.each([true, false])(
    'waits for workflow readiness before human input submission (installed=%s)',
    async (installed) => {
      const { user } = renderSubject({
        isInstalledApp: installed,
        currentConversationId: 'conversation-1',
        appPrevChatList: [question('paused-question', 'Question', pausedAnswer())],
      })
      await user.click(await screen.findByRole('button', { name: 'Approve' }))
      expect(submitHumanInputForm).not.toHaveBeenCalled()
      expect(submitInstalledHumanInput).not.toHaveBeenCalled()
      confirmPaused()
      await waitFor(() =>
        expect(
          installed ? submitInstalledHumanInput : submitHumanInputForm,
        ).toHaveBeenCalledExactlyOnceWith('form-token', { inputs: {}, action: 'approve' }),
      )
      expect(installed ? submitHumanInputForm : submitInstalledHumanInput).not.toHaveBeenCalled()
    },
  )

  it('does not submit human input when the workflow subscription fails', async () => {
    const { user } = renderSubject({
      currentConversationId: 'conversation-1',
      appPrevChatList: [question('paused-question', 'Question', pausedAnswer())],
    })
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    await act(async () => get.mock.calls[0]![2].onCompleted?.(true, 'Disconnected'))
    expect(submitHumanInputForm).not.toHaveBeenCalled()
    expect(submitInstalledHumanInput).not.toHaveBeenCalled()
  })

  it('regenerates a question and its edit against the preceding answer', async () => {
    const { user } = renderSubject({
      appPrevChatList: history(),
      currentConversationId: 'conversation-1',
    })
    await user.click(screen.getAllByRole('button', { name: 'common.operation.regenerate' }).at(-1)!)
    await completeReply('Regenerated answer')
    await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' }).at(-1)!)
    const editor = screen.getByDisplayValue('Original question')
    await user.clear(editor)
    await user.type(editor, 'new query{Enter}')
    expect(post.mock.calls.map((call) => call[1].body)).toEqual([
      expect.objectContaining({ query: 'Original question', parent_message_id: 'prior-answer' }),
      expect.objectContaining({ query: 'new query', parent_message_id: 'prior-answer' }),
    ])
    await completeReply('Edited answer', 1)
    expect(await screen.findByText('Edited answer')).toBeInTheDocument()
  })

  it('switches visible siblings and stops through the active chat instance', async () => {
    const siblings: ChatItemInTree[] = [
      {
        id: 'question-1',
        content: 'Question',
        isAnswer: false,
        children: [
          answer('sibling-1', 'First answer', { parentMessageId: 'question-1', siblingIndex: 0 }),
        ],
      },
      {
        id: 'question-2',
        content: 'Question',
        isAnswer: false,
        children: [
          answer('sibling-2', 'Second answer', {
            parentMessageId: 'question-2',
            siblingIndex: 1,
          }),
        ],
      },
    ]
    const { user, context } = renderSubject({
      appSourceType: AppSourceType.tryApp,
      currentConversationId: 'conversation-1',
      appPrevChatList: siblings,
    })
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(await screen.findByText('First answer')).toBeInTheDocument()
    expect(screen.queryByText('Second answer')).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Ask the assistant'), 'follow up{Enter}')
    act(() =>
      post.mock.calls[0]![2].onData?.('In progress', true, {
        messageId: 'response-0',
        taskId: 'task-0',
      }),
    )
    await user.click(screen.getByRole('button', { name: /stopResponding/ }))
    expect(stopChatMessageResponding).toHaveBeenCalledWith(
      '',
      'task-0',
      AppSourceType.tryApp,
      'app-1',
    )
    expect(screen.queryByRole('button', { name: /stopResponding/ })).not.toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Ask the assistant'), 'another request{Enter}')
    act(() =>
      post.mock.calls[1]![2].onData?.('Another response', true, {
        messageId: 'response-1',
        taskId: 'task-1',
      }),
    )
    await act(async () => context.currentChatInstanceRef.current.handleStop())
    expect(stopChatMessageResponding).toHaveBeenLastCalledWith(
      '',
      'task-1',
      AppSourceType.tryApp,
      'app-1',
    )
    expect(screen.queryByRole('button', { name: /stopResponding/ })).not.toBeInTheDocument()
  })

  it('resumes the deepest paused workflow once for the loaded conversation', async () => {
    const parent = pausedAnswer('parent', 'parent-run')
    parent.children = [
      {
        ...question('child-question', 'Follow-up', pausedAnswer('child', 'child-run')),
        parentMessageId: 'parent',
      },
    ]
    const conversation = [question('parent-question', 'Question', parent)]
    const { updateContext } = renderSubject({
      appPrevChatList: conversation,
      currentConversationId: 'conversation-1',
    })
    await waitFor(() =>
      expect(get).toHaveBeenCalledExactlyOnceWith(
        '/workflow/child-run/events?include_state_snapshot=true&continue_on_pause=true',
        {},
        expect.objectContaining({ isPublicAPI: true }),
      ),
    )
    updateContext({ appPrevChatList: conversation, currentConversationId: 'conversation-1' })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('shows welcome when inputs hidden and hides it while responding', async () => {
    const { user } = renderSubject({
      newConversationInputs: { name: 'Ada' },
      newConversationInputsRef: { current: { name: 'Ada' } },
      inputsForms: [
        { variable: 'name', label: 'Name', required: true, type: InputVarType.textInput },
      ],
      allInputsHidden: true,
      appParams: createChatConfigFixture({ opening_statement: 'Welcome to the app' }),
    })
    const welcome = await screen.findByText('Welcome to the app')
    expect(welcome).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Ask the assistant'), 'hello world{Enter}')
    act(() =>
      post.mock.calls[0]![2].onData?.('In progress', true, {
        messageId: 'response-0',
        taskId: 'task-0',
      }),
    )
    expect(screen.getByRole('button', { name: /stopResponding/ })).toBeVisible()
    // The opening statement remains in chat, but the original welcome presentation is removed.
    expect(welcome).not.toBeInTheDocument()
    expect(screen.getByText('Welcome to the app')).toBeVisible()
  })
})
