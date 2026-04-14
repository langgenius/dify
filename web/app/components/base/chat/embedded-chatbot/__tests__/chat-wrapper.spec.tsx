import type { RefObject } from 'react'
import type { ChatConfig, ChatItem, ChatItemInTree } from '../../types'
import type { EmbeddedChatbotContextValue } from '../context'
import type { ConversationItem } from '@/models/share'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import {
  AppSourceType,
  fetchSuggestedQuestions,
  submitHumanInputForm,
} from '@/service/share'
import { submitHumanInputForm as submitHumanInputFormService } from '@/service/workflow'
import { useChat } from '../../chat/hooks'
import ChatWrapper from '../chat-wrapper'
import { useEmbeddedChatbotContext } from '../context'

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
    onRegenerate: (chatItem: ChatItem, editedQuestion?: { message: string, files?: never[] }) => void
    switchSibling: (siblingMessageId: string) => void
    onHumanInputFormSubmit: (formToken: string, formData: Record<string, string>) => Promise<void>
    onStopResponding: () => void
  }) => (
    <div>
      <div>{chatNode}</div>
      {answerIcon}
      {chatList.map(item => <div key={item.id}>{item.content}</div>)}
      <div>
        chat count:
        {' '}
        {chatList.length}
      </div>
      {questionIcon}
      <button onClick={() => onSend('hello world')}>send through chat</button>
      <button onClick={() => onRegenerate({ id: 'answer-1', isAnswer: true, content: 'answer', parentMessageId: 'question-1' })}>regenerate answer</button>
      <button onClick={() => onRegenerate({ id: 'answer-1', isAnswer: true, content: 'answer', parentMessageId: 'question-1' }, { message: 'new query' })}>regenerate edited</button>
      <button onClick={() => switchSibling('sibling-2')}>switch sibling</button>
      <button disabled={inputDisabled}>send message</button>
      <button onClick={onStopResponding}>stop responding</button>
      <button onClick={() => onHumanInputFormSubmit('form-token', { answer: 'ok' })}>submit human input</button>
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

const createContextValue = (overrides: Partial<EmbeddedChatbotContextValue> = {}): EmbeddedChatbotContextValue => ({
  appMeta: { tool_icons: {} },
  appData: {
    app_id: 'app-1',
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
  themeBuilder: undefined,
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

  describe('Welcome behavior', () => {
    it('should show opening message and suggested question for a new chat', () => {
      const handleSwitchSibling = vi.fn()
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        handleSwitchSibling,
        chatList: [{ id: 'opening-1', isAnswer: true, isOpeningStatement: true, content: 'Welcome to the app', suggestedQuestions: ['How does it work?'] }],
      }))
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        appPrevChatList: [
          {
            id: 'parent-node',
            content: 'parent',
            isAnswer: true,
            children: [
              {
                id: 'paused-workflow',
                content: 'paused',
                isAnswer: true,
                workflow_run_id: 'run-1',
                humanInputFormDataList: [{ label: 'Need info' }],
              } as unknown as ChatItem,
            ],
          } as unknown as ChatItem,
        ],
      }))

      render(<ChatWrapper />)

      expect(screen.getByText('How does it work?')).toBeInTheDocument()
      expect(handleSwitchSibling).toHaveBeenCalledWith('paused-workflow', expect.objectContaining({
        isPublicAPI: true,
      }))
      const resumeOptions = handleSwitchSibling.mock.calls[0]?.[1] as { onGetSuggestedQuestions: (responseItemId: string) => void }
      resumeOptions.onGetSuggestedQuestions('resume-1')
      expect(fetchSuggestedQuestions).toHaveBeenCalledWith('resume-1', AppSourceType.webApp, 'app-1')
    })

    it('should hide or show welcome content based on chat state', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [{ variable: 'name', label: 'Name', required: true, type: InputVarType.textInput }],
        currentConversationId: '',
        allInputsHidden: false,
      }))
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        chatList: [{ id: 'opening-1', isAnswer: true, isOpeningStatement: true, content: 'Welcome to the app' }],
      }))

      render(<ChatWrapper />)

      expect(screen.queryByText('Welcome to the app')).not.toBeInTheDocument()
      expect(screen.getByText('inputs form')).toBeInTheDocument()

      cleanup()
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [],
        currentConversationId: '',
        allInputsHidden: true,
      }))
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        chatList: [{ id: 'opening-2', isAnswer: true, isOpeningStatement: true, content: 'Fallback welcome' }],
      }))

      render(<ChatWrapper />)
      expect(screen.queryByText('inputs form')).not.toBeInTheDocument()

      cleanup()
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        appData: null,
      }))
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        isResponding: false,
        chatList: [{ id: 'opening-3', isAnswer: true, isOpeningStatement: true, content: 'Should be hidden' }],
      }))

      render(<ChatWrapper />)
      expect(screen.queryByText('Should be hidden')).not.toBeInTheDocument()

      cleanup()
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue())
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        isResponding: true,
        chatList: [{ id: 'opening-4', isAnswer: true, isOpeningStatement: true, content: 'Should be hidden while responding' }],
      }))
      render(<ChatWrapper />)
      expect(screen.queryByText('Should be hidden while responding')).not.toBeInTheDocument()
    })
  })

  describe('Input and avatar behavior', () => {
    it('should disable sending when required fields are incomplete or uploading', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [{ variable: 'email', label: 'Email', required: true, type: InputVarType.textInput }],
        newConversationInputsRef: { current: {} },
      }))

      render(<ChatWrapper />)

      expect(screen.getByRole('button', { name: 'send message' })).toBeDisabled()

      cleanup()
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [{ variable: 'file', label: 'File', required: true, type: InputVarType.multiFiles }],
        newConversationInputsRef: {
          current: {
            file: [
              {
                transferMethod: 'local_file',
              },
            ],
          },
        },
      }))

      render(<ChatWrapper />)
      expect(screen.getByRole('button', { name: 'send message' })).toBeDisabled()

      cleanup()
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [{ variable: 'singleFile', label: 'Single file', required: true, type: InputVarType.singleFile }],
        newConversationInputsRef: {
          current: {
            singleFile: {
              transferMethod: 'local_file',
            },
          },
        },
      }))
      render(<ChatWrapper />)
      expect(screen.getByRole('button', { name: 'send message' })).toBeDisabled()
    })

    it('should show the user avatar fallback when avatar data is provided', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        initUserVariables: {
          avatar_url: 'https://example.com/avatar.png',
          name: 'Alice',
        },
      }))

      render(<ChatWrapper />)

      expect(screen.getByText('A')).toBeInTheDocument()
    })
  })

  describe('Human input submit behavior', () => {
    it('should submit via installed app service when the app is installed', async () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        isInstalledApp: true,
      }))

      render(<ChatWrapper />)
      fireEvent.click(screen.getByRole('button', { name: 'submit human input' }))

      await waitFor(() => {
        expect(submitHumanInputFormService).toHaveBeenCalledWith('form-token', { answer: 'ok' })
      })
      expect(submitHumanInputForm).not.toHaveBeenCalled()
    })

    it('should submit via share service and support chat actions in web app mode', async () => {
      const handleSend = vi.fn()
      const handleSwitchSibling = vi.fn()
      const handleStop = vi.fn()
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        handleSend,
        handleSwitchSibling,
        handleStop,
        chatList: [
          { id: 'opening-1', isAnswer: true, isOpeningStatement: true, content: 'Welcome' },
          { id: 'question-1', isAnswer: false, content: 'Question' },
          { id: 'answer-1', isAnswer: true, content: 'Answer', parentMessageId: 'question-1' },
        ] as ChatItemInTree[],
      }))
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        isInstalledApp: false,
        appSourceType: AppSourceType.tryApp,
        isMobile: true,
        inputsForms: [{ variable: 'topic', label: 'Topic', required: false, type: InputVarType.textInput }],
        currentConversationId: 'conversation-1',
      }))
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
        expect(submitHumanInputForm).toHaveBeenCalledWith('form-token', { answer: 'ok' })
      })
      expect(handleSend).toHaveBeenCalledTimes(2)
      const sendOptions = handleSend.mock.calls[0]?.[2] as { onGetSuggestedQuestions: (responseItemId: string) => void }
      sendOptions.onGetSuggestedQuestions('resp-1')
      expect(handleSwitchSibling).toHaveBeenCalledWith('sibling-2', expect.objectContaining({
        isPublicAPI: false,
      }))
      const switchOptions = handleSwitchSibling.mock.calls.find(call => call[0] === 'sibling-2')?.[1] as { onGetSuggestedQuestions: (responseItemId: string) => void }
      switchOptions.onGetSuggestedQuestions('resp-2')
      expect(fetchSuggestedQuestions).toHaveBeenCalledWith('resp-1', AppSourceType.tryApp, 'app-1')
      expect(fetchSuggestedQuestions).toHaveBeenCalledWith('resp-2', AppSourceType.tryApp, 'app-1')
      expect(handleStop).toHaveBeenCalled()
      expect(screen.queryByRole('img', { name: 'Alice' })).not.toBeInTheDocument()

      cleanup()
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        isMobile: true,
        currentConversationId: '',
        inputsForms: [{ variable: 'topic', label: 'Topic', required: false, type: InputVarType.textInput }],
      }))
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        chatList: [{ id: 'opening-mobile', isAnswer: true, isOpeningStatement: true, content: 'Mobile welcome' }],
      }))

      render(<ChatWrapper />)
      expect(screen.getByText('inputs form')).toBeInTheDocument()
    })

    it('should not disable sending when a required checkbox is not checked', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [{ variable: 'agree', label: 'Agree', required: true, type: InputVarType.checkbox }],
        newConversationInputsRef: { current: { agree: false } },
      }))
      render(<ChatWrapper />)
      expect(screen.getByRole('button', { name: 'send message' })).not.toBeDisabled()
    })

    it('should return null for chatNode when all inputs are hidden', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        allInputsHidden: true,
        inputsForms: [{ variable: 'test', label: 'Test', type: InputVarType.textInput }],
      }))
      render(<ChatWrapper />)
      expect(screen.queryByText('inputs form')).not.toBeInTheDocument()
    })

    it('should render simple welcome message when suggested questions are absent', () => {
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        chatList: [{ id: 'opening-1', isAnswer: true, isOpeningStatement: true, content: 'Simple Welcome' }] as ChatItem[],
      }))
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        currentConversationId: '',
      }))
      render(<ChatWrapper />)
      expect(screen.getByText('Simple Welcome')).toBeInTheDocument()
    })

    it('should use icon as answer icon when enabled in site config', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        appData: {
          app_id: 'app-1',
          can_replace_logo: true,
          custom_config: { remove_webapp_brand: false, replace_webapp_logo: '' },
          enable_site: true,
          end_user_id: 'user-1',
          site: {
            title: 'Embedded App',
            icon_type: 'emoji',
            icon: 'bot',
            icon_background: '#000000',
            icon_url: '',
            use_icon_as_answer_icon: true,
          },
        },
      }))
      render(<ChatWrapper />)
    })
  })

  describe('Regeneration and config variants', () => {
    it('should handle regeneration with edited question', async () => {
      const handleSend = vi.fn()
      // IDs must match what's hardcoded in the mock Chat component's regenerate button
      const chatList = [
        { id: 'question-1', isAnswer: false, content: 'Old question' },
        { id: 'answer-1', isAnswer: true, content: 'Old answer', parentMessageId: 'question-1' },
      ]
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        handleSend,
        chatList: chatList as ChatItem[],
      }))

      render(<ChatWrapper />)
      const regenBtn = screen.getByRole('button', { name: 'regenerate answer' })

      fireEvent.click(regenBtn)
      expect(handleSend).toHaveBeenCalled()
    })

    it('should use opening statement from currentConversationItem if available', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        appParams: { opening_statement: 'Global opening' } as ChatConfig,
        currentConversationItem: {
          id: 'conv-1',
          name: 'Conversation 1',
          inputs: {},
          introduction: 'Conversation specific opening',
        } as ConversationItem,
      }))
      render(<ChatWrapper />)
    })

    it('should handle mobile chatNode variants', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        isMobile: true,
        currentConversationId: 'conv-1',
      }))
      render(<ChatWrapper />)
    })

    it('should initialize collapsed based on currentConversationId and isTryApp', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        currentConversationId: 'conv-1',
        appSourceType: AppSourceType.tryApp,
      }))
      render(<ChatWrapper />)
    })

    it('should resume paused workflows when chat history is loaded', () => {
      const handleSwitchSibling = vi.fn()
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        handleSwitchSibling,
      }))
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        appPrevChatList: [
          {
            id: 'node-1',
            isAnswer: true,
            content: '',
            workflow_run_id: 'run-1',
            humanInputFormDataList: [{ label: 'text', variable: 'v', required: true, type: InputVarType.textInput, hide: false }],
            children: [],
          } as unknown as ChatItemInTree,
        ],
      }))
      render(<ChatWrapper />)
      expect(handleSwitchSibling).toHaveBeenCalled()
    })

    it('should handle conversation completion and suggested questions in chat actions', async () => {
      const handleSend = vi.fn()
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        handleSend,
      }))
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        currentConversationId: 'conv-id', // index 0 true target
        appSourceType: AppSourceType.webApp,
      }))

      render(<ChatWrapper />)
      fireEvent.click(screen.getByRole('button', { name: 'send through chat' }))

      expect(handleSend).toHaveBeenCalled()
      const options = handleSend.mock.calls[0]?.[2] as { onConversationComplete?: (id: string) => void }
      expect(options.onConversationComplete).toBeUndefined()
    })

    it('should handle regeneration with parent answer and edited question', () => {
      const handleSend = vi.fn()
      const chatList = [
        { id: 'question-1', isAnswer: false, content: 'Q1' },
        { id: 'answer-1', isAnswer: true, content: 'A1', parentMessageId: 'question-1', metadata: { usage: { total_tokens: 10 } } },
      ]
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        handleSend,
        chatList: chatList as ChatItem[],
      }))

      render(<ChatWrapper />)
      fireEvent.click(screen.getByRole('button', { name: 'regenerate edited' }))
      expect(handleSend).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ query: 'new query' }), expect.any(Object))
    })

    it('should handle fallback values for config and user data', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        appParams: null,
        appId: undefined,
        initUserVariables: { avatar_url: 'url' }, // name is missing
      }))
      render(<ChatWrapper />)
    })

    it('should handle mobile view for welcome screens', () => {
      // Complex welcome mobile
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        chatList: [{ id: 'o-1', isAnswer: true, isOpeningStatement: true, content: 'Welcome', suggestedQuestions: ['Q?'] }] as ChatItem[],
      }))
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        isMobile: true,
        currentConversationId: '',
      }))
      render(<ChatWrapper />)

      cleanup()
      // Simple welcome mobile
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        chatList: [{ id: 'o-2', isAnswer: true, isOpeningStatement: true, content: 'Welcome' }] as ChatItem[],
      }))
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        isMobile: true,
        currentConversationId: '',
      }))
      render(<ChatWrapper />)
    })

    it('should handle loop early returns in input validation', () => {
      // hasEmptyInput early return (line 103)
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [
          { variable: 'v1', label: 'V1', required: true, type: InputVarType.textInput },
          { variable: 'v2', label: 'V2', required: true, type: InputVarType.textInput },
        ],
        newConversationInputsRef: { current: { v1: '', v2: '' } },
      }))
      render(<ChatWrapper />)

      cleanup()
      // fileIsUploading early return (line 106)
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        inputsForms: [
          { variable: 'f1', label: 'F1', required: true, type: InputVarType.singleFile },
          { variable: 'v2', label: 'V2', required: true, type: InputVarType.textInput },
        ],
        newConversationInputsRef: {
          current: {
            f1: { transferMethod: 'local_file', uploadedId: '' },
            v2: '',
          },
        },
      }))
      render(<ChatWrapper />)
    })

    it('should handle null/undefined refs and config fallbacks', () => {
      vi.mocked(useEmbeddedChatbotContext).mockReturnValue(createContextValue({
        currentChatInstanceRef: { current: null } as unknown as RefObject<{ handleStop: () => void }>,
        appParams: null,
        appMeta: null,
      }))
      render(<ChatWrapper />)
    })

    it('should handle isValidGeneratedAnswer truthy branch in regeneration', () => {
      const handleSend = vi.fn()
      // A valid generated answer needs metadata with usage
      const chatList = [
        { id: 'question-1', isAnswer: false, content: 'Q' },
        { id: 'answer-1', isAnswer: true, content: 'A', metadata: { usage: { total_tokens: 10 } }, parentMessageId: 'question-1' },
      ]
      vi.mocked(useChat).mockReturnValue(createUseChatReturn({
        handleSend,
        chatList: chatList as ChatItem[],
      }))
      render(<ChatWrapper />)
      fireEvent.click(screen.getByRole('button', { name: 'regenerate answer' }))
      expect(handleSend).toHaveBeenCalled()
    })
  })
})
