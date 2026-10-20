import type { HumanInputFieldValue } from '../../chat/answer/human-input-content/field-renderer'
import type { ChatConfig, ChatItem, ChatItemInTree } from '../../types'
import type { EmbeddedChatbotContextValue } from '../context'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { AppSourceType, fetchSuggestedQuestions, submitHumanInputForm } from '@/service/share'
import { submitHumanInputForm as submitHumanInputFormService } from '@/service/workflow'
import { createDeferred } from '@/test/deferred'
import { useChat } from '../../chat/hooks'
import ChatWrapper from '../chat-wrapper'
import { EmbeddedChatbotContext } from '../context'

const mockTrackEvent = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/amplitude/web-app-event', () => ({
  trackWebAppEvent: mockTrackEvent,
}))

vi.mock('../../chat/hooks', () => ({
  useChat: vi.fn(),
}))

vi.mock('../inputs-form', () => ({
  __esModule: true,
  default: () => <div>inputs form</div>,
}))

vi.mock('../../chat', () => ({
  __esModule: true,
  default: ({
    chatNode,
    chatList,
    inputDisabled,
    questionIcon,
    answerIcon,
    onSend,
    onRegenerate,
    switchSibling,
    onHumanInputFormSubmit,
    onStopResponding,
  }: {
    chatNode: React.ReactNode
    chatList: ChatItem[]
    inputDisabled: boolean
    questionIcon?: React.ReactNode
    answerIcon?: React.ReactNode
    onSend: (message: string) => void
    onRegenerate: (
      chatItem: ChatItem,
      editedQuestion?: { message: string; files?: never[] },
    ) => void
    switchSibling: (siblingMessageId: string) => void
    onHumanInputFormSubmit: (
      formToken: string,
      formData: { inputs: Record<string, HumanInputFieldValue>; action: string },
    ) => Promise<void>
    onStopResponding: () => void
  }) => (
    <div>
      <div>{chatNode}</div>
      {answerIcon}
      {chatList.map((item) => (
        <div key={item.id}>{item.content}</div>
      ))}
      <div>chat count: {chatList.length}</div>
      {questionIcon}
      <button onClick={() => onSend('hello world')}>send through chat</button>
      <button
        onClick={() =>
          onRegenerate({
            id: 'answer-1',
            isAnswer: true,
            content: 'answer',
            parentMessageId: 'question-1',
          })
        }
      >
        regenerate answer
      </button>
      <button
        onClick={() =>
          onRegenerate(
            {
              id: 'question-1',
              isAnswer: false,
              content: 'question',
              parentMessageId: 'prior-answer',
            },
            { message: 'new query' },
          )
        }
      >
        regenerate edited
      </button>
      <button onClick={() => switchSibling('sibling-2')}>switch sibling</button>
      <button disabled={inputDisabled}>send message</button>
      <button onClick={onStopResponding}>stop responding</button>
      <button
        onClick={() =>
          onHumanInputFormSubmit('form-token', { inputs: { answer: 'ok' }, action: 'approve' })
        }
      >
        submit human input
      </button>
    </div>
  ),
}))

vi.mock('@/service/share', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/share')>()
  return {
    ...actual,
    fetchSuggestedQuestions: vi.fn(),
    getUrl: vi.fn(() => '/chat-messages'),
    stopChatMessageResponding: vi.fn(),
    submitHumanInputForm: vi.fn(),
  }
})

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: vi.fn(),
}))

const mockIsDify = vi.fn(() => false)
vi.mock('../utils', () => ({
  isDify: () => mockIsDify(),
}))

type UseChatReturn = ReturnType<typeof useChat>

const createContextValue = (
  overrides: Partial<EmbeddedChatbotContextValue> = {},
): EmbeddedChatbotContextValue => ({
  appMeta: { tool_icons: {} },
  appData: {
    app_id: 'app-1',
    mode: 'chat',
    can_replace_logo: true,
    custom_config: {
      remove_webapp_brand: false,
      replace_webapp_logo: '',
    },
    enable_site: true,
    end_user_id: 'user-1',
    site: {
      title: 'Embedded App',
      icon_type: 'emoji',
      icon: 'bot',
      icon_background: '#000000',
      icon_url: '',
      use_icon_as_answer_icon: false,
    },
  },
  appParams: {
    system_parameters: {
      audio_file_size_limit: 1,
      file_size_limit: 1,
      image_file_size_limit: 1,
      video_file_size_limit: 1,
      workflow_file_upload_limit: 1,
    },
    more_like_this: {
      enabled: false,
    },
  } as ChatConfig,
  appChatListDataLoading: false,
  currentConversationId: '',
  currentConversationItem: undefined,
  appPrevChatList: [],
  pinnedConversationList: [],
  conversationList: [],
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  handleNewConversationInputsChange: vi.fn(),
  inputsForms: [],
  handleNewConversation: vi.fn(),
  handleStartChat: vi.fn(),
  handleChangeConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  chatShouldReloadKey: 'reload-key',
  isMobile: false,
  isInstalledApp: false,
  appSourceType: AppSourceType.webApp,
  allowResetChat: true,
  appId: 'app-1',
  disableFeedback: false,
  handleFeedback: vi.fn(),
  currentChatInstanceRef: { current: { handleStop: vi.fn() } },
  theme: undefined,
  clearChatList: false,
  setClearChatList: vi.fn(),
  isResponding: false,
  setIsResponding: vi.fn(),
  currentConversationInputs: {},
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  initUserVariables: {},
  ...overrides,
})

const createUseChatReturn = (overrides: Partial<UseChatReturn> = {}): UseChatReturn => ({
  chatList: [],
  setTargetMessageId: vi.fn() as UseChatReturn['setTargetMessageId'],
  handleSend: vi.fn(),
  handleResume: vi.fn(),
  setIsResponding: vi.fn() as UseChatReturn['setIsResponding'],
  handleStop: vi.fn(),
  handleSwitchSibling: vi.fn(),
  prepareHumanInputSubmission: vi.fn().mockResolvedValue(true),
  isResponding: false,
  suggestedQuestions: [],
  handleRestart: vi.fn(),
  handleAnnotationEdited: vi.fn(),
  handleAnnotationAdded: vi.fn(),
  handleAnnotationRemoved: vi.fn(),
  ...overrides,
})

function renderSubject(
  contextOverrides: Partial<EmbeddedChatbotContextValue> = {},
  chatOverrides: Partial<UseChatReturn> = {},
) {
  const context = createContextValue(contextOverrides)
  const chat = createUseChatReturn(chatOverrides)
  vi.mocked(useChat).mockReturnValue(chat)
  const result = render(
    <EmbeddedChatbotContext.Provider value={context}>
      <ChatWrapper />
    </EmbeddedChatbotContext.Provider>,
  )
  return {
    ...result,
    context,
    chat,
    user: userEvent.setup(),
    updateContext: (changes: Partial<EmbeddedChatbotContextValue>) =>
      result.rerender(
        <EmbeddedChatbotContext.Provider value={{ ...context, ...changes }}>
          <ChatWrapper />
        </EmbeddedChatbotContext.Provider>,
      ),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsDify.mockReturnValue(false)
})

describe('Embedded chatbot orchestration', () => {
  it.each([
    [InputVarType.textInput, '', true],
    [InputVarType.textInput, 'Ada', false],
    [InputVarType.number, 0, false],
    [InputVarType.checkbox, false, false],
    [InputVarType.multiFiles, [], true],
    [InputVarType.multiFiles, [{ transferMethod: 'local_file' }], true],
    [InputVarType.multiFiles, [{ transferMethod: 'local_file', uploadedId: 'upload-1' }], false],
    [InputVarType.singleFile, { transferMethod: 'local_file' }, true],
    [InputVarType.singleFile, { transferMethod: 'local_file', uploadedId: 'upload-1' }, false],
  ])('enforces required %s input readiness for %j', (type, value, disabled) => {
    renderSubject({
      inputsForms: [{ variable: 'value', label: 'Value', required: true, type }],
      newConversationInputsRef: { current: { value } },
    })
    const send = screen.getByRole('button', { name: 'send message' })
    if (disabled) expect(send).toBeDisabled()
    else expect(send).toBeEnabled()
  })

  it('uses existing conversation inputs rather than new-conversation defaults', async () => {
    const { user, chat } = renderSubject(
      {
        currentConversationId: 'conversation-1',
        currentConversationInputs: { topic: 'saved' },
        newConversationInputs: { topic: 'new' },
        newConversationInputsRef: { current: {} },
        inputsForms: [
          { variable: 'topic', label: 'Topic', required: true, type: InputVarType.textInput },
        ],
      },
      { chatList: [{ id: 'last-answer', isAnswer: true, content: 'Answer' }] },
    )
    expect(screen.getByRole('button', { name: 'send message' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'send through chat' }))
    expect(chat.handleSend).toHaveBeenCalledExactlyOnceWith(
      '/chat-messages',
      {
        query: 'hello world',
        files: undefined,
        inputs: { topic: 'saved' },
        conversation_id: 'conversation-1',
        parent_message_id: 'last-answer',
      },
      {
        onGetSuggestedQuestions: expect.any(Function),
        onConversationComplete: undefined,
        isPublicAPI: true,
      },
    )
    expect(mockTrackEvent).toHaveBeenCalledExactlyOnceWith('webapp_run', { app_mode: 'chat' })
  })

  it('wires completion and suggested questions for a new conversation', async () => {
    const { user, chat, context } = renderSubject({ newConversationInputs: { topic: 'new' } })
    await user.click(screen.getByRole('button', { name: 'send through chat' }))
    expect(chat.handleSend).toHaveBeenCalledWith(
      '/chat-messages',
      {
        query: 'hello world',
        files: undefined,
        inputs: { topic: 'new' },
        conversation_id: '',
        parent_message_id: null,
      },
      expect.objectContaining({ isPublicAPI: true }),
    )
    const options = vi.mocked(chat.handleSend).mock.calls[0]![2]!
    options.onConversationComplete?.('created-conversation')
    options.onGetSuggestedQuestions?.('response-1', vi.fn())
    expect(context.handleNewConversationCompleted).toHaveBeenCalledExactlyOnceWith(
      'created-conversation',
    )
    expect(fetchSuggestedQuestions).toHaveBeenCalledExactlyOnceWith(
      'response-1',
      AppSourceType.webApp,
      'app-1',
    )
  })

  it.each([true, false])(
    'waits for workflow readiness before submitting human input (installed=%s)',
    async (installed) => {
      const ready = createDeferred<boolean>()
      const { user, chat } = renderSubject(
        { isInstalledApp: installed },
        { prepareHumanInputSubmission: vi.fn(() => ready.promise) },
      )
      await user.click(screen.getByRole('button', { name: 'submit human input' }))
      expect(chat.prepareHumanInputSubmission).toHaveBeenCalledTimes(1)
      expect(submitHumanInputFormService).not.toHaveBeenCalled()
      expect(submitHumanInputForm).not.toHaveBeenCalled()
      await act(async () => ready.resolve(true))
      const service = installed ? submitHumanInputFormService : submitHumanInputForm
      const otherService = installed ? submitHumanInputForm : submitHumanInputFormService
      expect(service).toHaveBeenCalledExactlyOnceWith('form-token', {
        inputs: { answer: 'ok' },
        action: 'approve',
      })
      expect(otherService).not.toHaveBeenCalled()
    },
  )

  it('does not submit human input when the workflow cannot resume', async () => {
    const { user } = renderSubject(
      {},
      { prepareHumanInputSubmission: vi.fn().mockResolvedValue(false) },
    )
    await user.click(screen.getByRole('button', { name: 'submit human input' }))
    expect(submitHumanInputForm).not.toHaveBeenCalled()
    expect(submitHumanInputFormService).not.toHaveBeenCalled()
  })

  it('regenerates the original question or its edit against the preceding answer', async () => {
    const chatList = [
      {
        id: 'prior-answer',
        isAnswer: true,
        content: 'Previous answer',
        metadata: { usage: { total_tokens: 10 } },
      },
      {
        id: 'question-1',
        isAnswer: false,
        content: 'Original question',
        parentMessageId: 'prior-answer',
      },
      { id: 'answer-1', isAnswer: true, content: 'Answer', parentMessageId: 'question-1' },
    ] as ChatItem[]
    const { user, chat } = renderSubject({}, { chatList })
    await user.click(screen.getByRole('button', { name: 'regenerate answer' }))
    await user.click(screen.getByRole('button', { name: 'regenerate edited' }))
    expect(vi.mocked(chat.handleSend).mock.calls.map((call) => call[1])).toEqual([
      {
        query: 'Original question',
        files: undefined,
        inputs: {},
        conversation_id: '',
        parent_message_id: 'prior-answer',
      },
      {
        query: 'new query',
        files: undefined,
        inputs: {},
        conversation_id: '',
        parent_message_id: 'prior-answer',
      },
    ])
  })

  it('switches siblings and stops through the active chat instance', async () => {
    const { user, chat, context } = renderSubject({
      appSourceType: AppSourceType.tryApp,
      currentConversationId: 'conversation-1',
    })
    await user.click(screen.getByRole('button', { name: 'switch sibling' }))
    expect(chat.handleSwitchSibling).toHaveBeenCalledExactlyOnceWith('sibling-2', {
      onGetSuggestedQuestions: expect.any(Function),
      onConversationComplete: undefined,
      isPublicAPI: false,
    })
    await user.click(screen.getByRole('button', { name: 'stop responding' }))
    expect(chat.handleStop).toHaveBeenCalledTimes(1)
    context.currentChatInstanceRef.current.handleStop()
    expect(chat.handleStop).toHaveBeenCalledTimes(2)
    expect(mockTrackEvent).not.toHaveBeenCalled()
  })

  it('resumes the deepest paused workflow after history arrives, only once per conversation', async () => {
    const { updateContext, chat } = renderSubject()
    const pausedChild = {
      id: 'child',
      isAnswer: true,
      content: '',
      workflow_run_id: 'run-1',
      humanInputFormDataList: [{ label: 'Need info' }],
      children: [],
    }
    const history = [
      { ...pausedChild, id: 'parent', children: [pausedChild] },
    ] as unknown as ChatItemInTree[]
    expect(chat.handleSwitchSibling).not.toHaveBeenCalled()
    updateContext({ appPrevChatList: history, currentConversationId: 'conversation-1' })
    await waitFor(() =>
      expect(chat.handleSwitchSibling).toHaveBeenCalledExactlyOnceWith(
        'child',
        expect.objectContaining({ isPublicAPI: true }),
      ),
    )
    updateContext({ appPrevChatList: [...history], currentConversationId: 'conversation-1' })
    expect(chat.handleSwitchSibling).toHaveBeenCalledTimes(1)
  })

  it('shows the welcome text when input collection is hidden and hides it while responding', async () => {
    const { updateContext } = renderSubject(
      { inputsForms: [{ variable: 'name', required: true }], allInputsHidden: true },
      {
        chatList: [
          {
            id: 'opening',
            isAnswer: true,
            isOpeningStatement: true,
            content: 'Welcome to the app',
          },
        ],
      },
    )
    expect(await screen.findByText('Welcome to the app')).toBeInTheDocument()
    expect(screen.queryByText('inputs form')).not.toBeInTheDocument()
    vi.mocked(useChat).mockReturnValue(
      createUseChatReturn({
        isResponding: true,
        chatList: [
          {
            id: 'opening',
            isAnswer: true,
            isOpeningStatement: true,
            content: 'Welcome to the app',
          },
        ],
      }),
    )
    updateContext({})
    expect(screen.queryByText('Welcome to the app')).not.toBeInTheDocument()
  })
})
