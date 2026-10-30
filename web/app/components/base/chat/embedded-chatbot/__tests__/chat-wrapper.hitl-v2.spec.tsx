import type { HumanInputFieldValue } from '../../chat/answer/human-input-content/field-renderer'
import type { ChatConfig, ChatItem, ChatItemInTree } from '../../types'
import type { EmbeddedChatbotContextValue } from '../context'
import type { HumanInputFormData } from '@/types/workflow'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import { AppSourceType, fetchSuggestedQuestions, submitHumanInputForm } from '@/service/share'
import { submitWebAppHumanInputForm } from '@/service/webapp-human-input'
import { submitHumanInputForm as submitHumanInputFormService } from '@/service/workflow'
import { useChat } from '../../chat/hooks'
import ChatWrapper from '../chat-wrapper'
import { useEmbeddedChatbotContext } from '../context'

const mockTrackEvent = vi.hoisted(() => vi.fn())

const createHumanInputForm = (
  formVersion: HumanInputFormData['form_version'],
): HumanInputFormData => ({
  form_version: formVersion,
  form_id: 'form-id',
  form_token: 'form-token',
  node_id: 'human-node',
  node_title: 'Review',
  form_content: 'Review',
  inputs: [],
  actions: [],
  resolved_default_values: {},
  display_in_ui: true,
  expiration_time: null,
})

vi.mock('@/app/components/base/amplitude/web-app-event', () => ({
  trackWebAppEvent: mockTrackEvent,
}))

vi.mock('../context', () => ({
  useEmbeddedChatbotContext: vi.fn(),
}))

vi.mock('../../chat/hooks', () => ({
  useChat: vi.fn(),
}))

vi.mock('../inputs-form', () => ({
  __esModule: true,
  default: () => <div>inputs form</div>,
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
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
            { id: 'answer-1', isAnswer: true, content: 'answer', parentMessageId: 'question-1' },
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

vi.mock('@/service/webapp-human-input', () => ({
  submitWebAppHumanInputForm: vi.fn(),
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

describe('EmbeddedChatbot chat-wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue())
    vi.mocked(useChat).mockReturnValue(createUseChatReturn())
  })

  describe('Human input submit behavior', () => {
    it.each([undefined, '1', '2'] as const)(
      'submits installed app forms with event version %s',
      async (formVersion) => {
        let resolveWorkflowEventsReady: (isReady: boolean) => void = () => {}
        const prepareHumanInputSubmission = vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              resolveWorkflowEventsReady = resolve
            }),
        )
        vi.mocked(useChat).mockReturnValue(
          createUseChatReturn({
            prepareHumanInputSubmission,
            chatList: [
              {
                id: 'answer-1',
                content: '',
                isAnswer: true,
                humanInputFormDataList: [createHumanInputForm(formVersion)],
              },
            ],
          }),
        )
        vi.mocked(useEmbeddedChatbotContext).mockReturnValue(
          createContextValue({
            isInstalledApp: true,
          }),
        )

        render(<ChatWrapper />)
        fireEvent.click(screen.getByRole('button', { name: 'submit human input' }))

        expect(prepareHumanInputSubmission).toHaveBeenCalledOnce()
        expect(submitHumanInputFormService).not.toHaveBeenCalled()

        await act(async () => {
          resolveWorkflowEventsReady(true)
        })
        await waitFor(() => {
          expect(submitHumanInputFormService).toHaveBeenCalledWith(
            'form-token',
            {
              inputs: { answer: 'ok' },
              action: 'approve',
            },
            formVersion,
          )
        })
        expect(submitHumanInputForm).not.toHaveBeenCalled()
      },
    )

    it.each([undefined, '1', '2'] as const)(
      'submits Web App forms with event version %s and supports chat actions',
      async (formVersion) => {
        const handleSend = vi.fn()
        const handleSwitchSibling = vi.fn()
        const handleStop = vi.fn()
        vi.mocked(useChat).mockReturnValue(
          createUseChatReturn({
            handleSend,
            handleSwitchSibling,
            handleStop,
            chatList: [
              { id: 'opening-1', isAnswer: true, isOpeningStatement: true, content: 'Welcome' },
              { id: 'question-1', isAnswer: false, content: 'Question' },
              {
                id: 'answer-1',
                isAnswer: true,
                content: 'Answer',
                parentMessageId: 'question-1',
                humanInputFormDataList: [createHumanInputForm(formVersion)],
              },
            ] as ChatItemInTree[],
          }),
        )
        vi.mocked(useEmbeddedChatbotContext).mockReturnValue(
          createContextValue({
            isInstalledApp: false,
            appSourceType: AppSourceType.tryApp,
            isMobile: true,
            inputsForms: [
              { variable: 'topic', label: 'Topic', required: false, type: InputVarType.textInput },
            ],
            currentConversationId: 'conversation-1',
          }),
        )
        mockIsDify.mockReturnValue(true)

        render(<ChatWrapper />)

        expect(screen.getByText('chat count: 3')).toBeInTheDocument()
        expect(screen.queryByText('inputs form')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'send through chat' }))
        fireEvent.click(screen.getByRole('button', { name: 'regenerate answer' }))
        fireEvent.click(screen.getByRole('button', { name: 'switch sibling' }))
        fireEvent.click(screen.getByRole('button', { name: 'stop responding' }))
        fireEvent.click(screen.getByRole('button', { name: 'submit human input' }))

        await waitFor(() => {
          expect(submitHumanInputForm).toHaveBeenCalledWith(
            'form-token',
            {
              inputs: { answer: 'ok' },
              action: 'approve',
            },
            formVersion,
          )
        })
        expect(handleSend).toHaveBeenCalledTimes(2)
        const sendOptions = handleSend.mock.calls[0]?.[2] as {
          onGetSuggestedQuestions: (responseItemId: string) => void
        }
        sendOptions.onGetSuggestedQuestions('resp-1')
        expect(handleSwitchSibling).toHaveBeenCalledWith(
          'sibling-2',
          expect.objectContaining({
            isPublicAPI: false,
          }),
        )
        const switchOptions = handleSwitchSibling.mock.calls.find(
          (call) => call[0] === 'sibling-2',
        )?.[1] as { onGetSuggestedQuestions: (responseItemId: string) => void }
        switchOptions.onGetSuggestedQuestions('resp-2')
        expect(fetchSuggestedQuestions).toHaveBeenCalledWith(
          'resp-1',
          AppSourceType.tryApp,
          'app-1',
        )
        expect(fetchSuggestedQuestions).toHaveBeenCalledWith(
          'resp-2',
          AppSourceType.tryApp,
          'app-1',
        )
        expect(handleStop).toHaveBeenCalled()
        expect(screen.queryByRole('img', { name: 'Alice' })).not.toBeInTheDocument()
        expect(mockTrackEvent).not.toHaveBeenCalled()

        cleanup()
        vi.mocked(useEmbeddedChatbotContext).mockReturnValue(
          createContextValue({
            isMobile: true,
            currentConversationId: '',
            inputsForms: [
              { variable: 'topic', label: 'Topic', required: false, type: InputVarType.textInput },
            ],
          }),
        )
        vi.mocked(useChat).mockReturnValue(
          createUseChatReturn({
            chatList: [
              {
                id: 'opening-mobile',
                isAnswer: true,
                isOpeningStatement: true,
                content: 'Mobile welcome',
              },
            ],
          }),
        )

        render(<ChatWrapper />)
        expect(screen.getByText('inputs form')).toBeInTheDocument()
      },
    )

    it.each(['1', '2', undefined] as const)(
      'submits web app version %s through the passport-aware service',
      async (formVersion) => {
        const user = userEvent.setup()
        vi.mocked(useChat).mockReturnValue(
          createUseChatReturn({
            chatList: [
              {
                id: 'answer-1',
                isAnswer: true,
                content: '',
                humanInputFormDataList: [createHumanInputForm(formVersion)],
              },
            ],
          }),
        )
        render(<ChatWrapper />)

        await user.click(screen.getByRole('button', { name: 'submit human input' }))

        expect(submitWebAppHumanInputForm).toHaveBeenCalledWith(
          'form-token',
          {
            inputs: { answer: 'ok' },
            action: 'approve',
          },
          formVersion,
        )
        expect(submitHumanInputForm).not.toHaveBeenCalled()
        expect(submitHumanInputFormService).not.toHaveBeenCalled()
      },
    )
  })
})
