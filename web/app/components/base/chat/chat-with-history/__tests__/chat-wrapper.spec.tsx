import type { ReactElement, ReactNode } from 'react'
import type { ChatConfig, ChatItemInTree } from '../../types'
import type { ChatWithHistoryContextValue } from '../context'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { AppData, AppMeta, ConversationItem } from '@/models/share'
import type { HumanInputFormData } from '@/types/workflow'
import { act, render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import {
  fetchChatList,
  fetchSuggestedQuestions,
  stopChatMessageResponding,
  submitHumanInputForm,
} from '@/service/share'
import { TransferMethod } from '@/types/app'
import { useChat } from '../../chat/hooks'
import ChatWrapper from '../chat-wrapper'
import { ChatWithHistoryContext } from '../context'

const mockTrackEvent = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/amplitude/web-app-event', () => ({
  trackWebAppEvent: mockTrackEvent,
}))

vi.mock('../../chat/hooks', () => ({
  useChat: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({ token: 'test-token' })),
}))

vi.mock('@/service/share', () => ({
  fetchChatList: vi.fn(),
  fetchSuggestedQuestions: vi.fn(),
  getUrl: vi.fn(() => 'mock-url'),
  stopChatMessageResponding: vi.fn(),
  submitHumanInputForm: vi.fn(),
  AppSourceType: {
    installedApp: 'installedApp',
    webApp: 'webApp',
  },
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: vi.fn(),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
    formatDate: (value: string) => `formatted-${value}`,
  }),
}))

type ChatHookReturn = ReturnType<typeof useChat>

const mockAppData = {
  mode: 'advanced-chat',
  site: {
    title: 'Test Chat',
    chat_color_theme: 'blue',
    icon_type: 'image',
    icon: 'test-icon',
    icon_background: '#000000',
    icon_url: 'https://example.com/icon.png',
    use_icon_as_answer_icon: false,
  },
} as unknown as AppData

const defaultContextValue: ChatWithHistoryContextValue = {
  appData: mockAppData,
  appParams: {
    system_parameters: { vision_config: { enabled: true } },
    opening_statement: 'Default opening statement',
  } as unknown as ChatConfig,
  appMeta: { tool_icons: {} } as unknown as AppMeta,
  currentConversationId: '1',
  currentConversationItem: { id: '1', name: 'Conv 1' } as unknown as ConversationItem,
  appPrevChatTree: [],
  newConversationInputs: {},
  newConversationInputsRef: {
    current: {},
  } as ChatWithHistoryContextValue['newConversationInputsRef'],
  inputsForms: [],
  isInstalledApp: false,
  currentChatInstanceRef: {
    current: { handleStop: vi.fn() },
  } as ChatWithHistoryContextValue['currentChatInstanceRef'],
  setIsResponding: vi.fn(),
  setClearChatList: vi.fn(),
  appChatListDataLoading: false,
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
  handleStartChat: vi.fn(),
  handleChangeConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  handleFeedback: vi.fn(),
  pinnedConversationList: [],
  chatShouldReloadKey: '',
  isMobile: false,
  currentConversationInputs: null,
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  initUserVariables: undefined,
  appId: 'test-app-id',
}

const defaultChatHookReturn: Partial<ChatHookReturn> = {
  chatList: [],
  handleSend: vi.fn(),
  handleStop: vi.fn(),
  handleSwitchSibling: vi.fn(),
  prepareHumanInputSubmission: vi.fn().mockResolvedValue(true),
  isResponding: false,
  suggestedQuestions: [],
}

let contextValue: ChatWithHistoryContextValue
const setContext = (value: ChatWithHistoryContextValue) => {
  contextValue = value
}
const render = (ui: ReactElement) =>
  rtlRender(ui, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <ChatWithHistoryContext.Provider value={contextValue}>
        {children}
      </ChatWithHistoryContext.Provider>
    ),
  })
const chatInput = () => screen.getByPlaceholderText(/common.chat.inputPlaceholder/)

describe('ChatWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useChat).mockReset()
    vi.mocked(fetchChatList).mockReset()
    vi.mocked(fetchSuggestedQuestions).mockReset()
    vi.mocked(submitHumanInputForm).mockReset()
    vi.mocked(defaultChatHookReturn.prepareHumanInputSubmission!)
      .mockReset()
      .mockResolvedValue(true)
    setContext(defaultContextValue)
    vi.mocked(useChat).mockReturnValue(defaultChatHookReturn as ChatHookReturn)
  })

  it.each([
    { id: 'a0', isAnswer: true, expected: 'a0' },
    { id: 'q0', isAnswer: false, expected: null },
    { id: 'answer-placeholder-0', isAnswer: true, expected: null },
  ])(
    'regenerates with the actual valid parent rule for $id',
    async ({ id, isAnswer, expected }) => {
      const handleSend = vi.fn()
      vi.mocked(useChat).mockReturnValue({
        ...defaultChatHookReturn,
        handleSend,
        chatList: [
          { id, isAnswer, content: 'Parent message' },
          { id: 'q1', content: 'Question to regenerate', parentMessageId: id },
          { id: 'a1', isAnswer: true, content: 'Answer to regenerate', parentMessageId: 'q1' },
        ],
      } as ChatHookReturn)
      render(<ChatWrapper />)
      await userEvent.click(
        screen.getAllByRole('button', { name: 'common.operation.regenerate' }).at(-1)!,
      )
      await waitFor(() =>
        expect(handleSend).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ query: 'Question to regenerate', parent_message_id: expected }),
          expect.any(Object),
        ),
      )
    },
  )
  it('should render welcome screen and handle message sending', async () => {
    const handleSend = vi.fn()
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
    })
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [
        { id: '1', isOpeningStatement: true, content: 'Welcome', suggestedQuestions: ['Q1', 'Q2'] },
      ],
      handleSend,
      suggestedQuestions: ['Q1', 'Q2'],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    expect(await screen.findByText('Welcome'))!.toBeInTheDocument()
    expect(await screen.findByText('Q1'))!.toBeInTheDocument()

    await userEvent.click(screen.getByText('Q1'))
    expect(handleSend).toHaveBeenCalled()
  })

  it.each([undefined, '', 'Conversation introduction'])(
    'selects the opening statement for introduction %s',
    (introduction) => {
      setContext({
        ...defaultContextValue,
        currentConversationItem:
          introduction === undefined
            ? undefined
            : { ...defaultContextValue.currentConversationItem!, introduction },
      })
      render(<ChatWrapper />)
      expect(vi.mocked(useChat).mock.lastCall?.[0]?.opening_statement).toBe(
        introduction || 'Default opening statement',
      )
    },
  )

  it('should handle manual message input and stop responding', async () => {
    const handleSend = vi.fn()
    const handleStop = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [],
      handleSend,
      handleStop,
    } as unknown as ChatHookReturn)

    const { rerender } = render(<ChatWrapper />)

    const textarea = chatInput()
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hello Bot')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalled()
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [{ id: '1', isAnswer: true, content: 'Thinking...', isResponding: true }],
      handleSend,
      handleStop,
      isResponding: true,
    } as unknown as ChatHookReturn)

    rerender(<ChatWrapper />)

    const stopButton = await screen.findByRole('button', {
      name: /appDebug.operation.stopResponding/i,
    })
    await userEvent.click(stopButton)
    expect(handleStop).toHaveBeenCalled()
  })

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
      value: { transferMethod: TransferMethod.local_file },
      required: true,
      disabled: true,
    },
    {
      name: 'uploaded file',
      type: InputVarType.singleFile,
      value: { transferMethod: TransferMethod.local_file, uploadedId: '123' },
      required: true,
      disabled: false,
    },
    {
      name: 'mixed uploads',
      type: InputVarType.multiFiles,
      value: [
        { transferMethod: TransferMethod.local_file, uploadedId: '123' },
        { transferMethod: TransferMethod.local_file },
      ],
      required: true,
      disabled: true,
    },
    {
      name: 'completed uploads',
      type: InputVarType.multiFiles,
      value: [
        { transferMethod: TransferMethod.local_file, uploadedId: '123' },
        { transferMethod: TransferMethod.local_file, uploadedId: '456' },
      ],
      required: true,
      disabled: false,
    },
  ])('gates the composer for $name', async ({ type, value, required, disabled }) => {
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      inputsForms: [{ variable: 'input', label: 'Input', type, required }],
      newConversationInputs: { input: value },
      newConversationInputsRef: { current: { input: value } },
    })
    render(<ChatWrapper />)
    expect(chatInput()).toHaveProperty('disabled', disabled)
    if (disabled) {
      await userEvent.type(chatInput(), 'blocked{Enter}')
      expect(defaultChatHookReturn.handleSend).not.toHaveBeenCalled()
    }
  })

  it('allows the composer when variable inputs are hidden', () => {
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      allInputsHidden: true,
      inputsForms: [
        { variable: 'req', label: 'Required', type: InputVarType.textInput, required: true },
      ],
    })
    render(<ChatWrapper />)
    expect(chatInput()).toBeEnabled()
  })

  it('should call fetchSuggestedQuestions from workflow resumption options callback', () => {
    const handleSwitchSibling = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [],
      handleSwitchSibling,
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      appPrevChatTree: [
        {
          id: 'resume-node',
          content: 'Paused answer',
          isAnswer: true,
          workflow_run_id: 'workflow-1',
          humanInputFormDataList: [{ label: 'resume' }] as unknown as HumanInputFormData[],
          children: [],
        },
      ],
    })

    render(<ChatWrapper />)

    expect(handleSwitchSibling).toHaveBeenCalledWith('resume-node', expect.any(Object))
    const resumeOptions = handleSwitchSibling.mock.calls[0]![1]
    resumeOptions.onGetSuggestedQuestions('response-from-resume')
    expect(fetchSuggestedQuestions).toHaveBeenCalledWith(
      'response-from-resume',
      'webApp',
      'test-app-id',
    )
  })

  it('should handle workflow resumption with nested children (DFS)', () => {
    const handleSwitchSibling = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [],
      handleSwitchSibling,
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      appPrevChatTree: [
        {
          id: '1',
          content: 'First',
          isAnswer: true,
          workflow_run_id: 'ancestor-workflow',
          humanInputFormDataList: [{ label: 'ancestor' }] as unknown as HumanInputFormData[],
          children: [
            {
              id: '2',
              content: 'Second',
              isAnswer: false,
              children: [
                {
                  id: '3',
                  content: 'Third',
                  isAnswer: true,
                  workflow_run_id: 'w2',
                  humanInputFormDataList: [{ label: 'third' }] as unknown as HumanInputFormData[],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    })

    render(<ChatWrapper />)
    expect(handleSwitchSibling).toHaveBeenCalledWith('3', expect.any(Object))
  })

  it('should not resume workflow if no paused workflows exist', () => {
    const handleSwitchSibling = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [],
      handleSwitchSibling,
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      appPrevChatTree: [
        {
          id: '1',
          content: 'Answer',
          isAnswer: true,
          children: [],
        },
      ],
    })

    render(<ChatWrapper />)
    expect(handleSwitchSibling).not.toHaveBeenCalled()
  })

  it('should call stopChatMessageResponding when handleStop is triggered', () => {
    const handleStop = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleStop,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    const onStopCallback = vi.mocked(useChat).mock.calls[0]![3] as (taskId: string) => void
    onStopCallback('taskId-123')
    expect(stopChatMessageResponding).toHaveBeenCalledWith(
      '',
      'taskId-123',
      'webApp',
      'test-app-id',
    )
  })

  it('should call fetchSuggestedQuestions in doSend options', async () => {
    const handleSend = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
      chatList: [
        { id: '1', isOpeningStatement: true, content: 'Welcome', suggestedQuestions: ['Q1'] },
      ],
      suggestedQuestions: ['Q1'],
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
    })

    render(<ChatWrapper />)

    await userEvent.click(await screen.findByText('Q1'))
    expect(handleSend).toHaveBeenCalled()

    const options = handleSend.mock.calls[0]![2]
    expect(options.isPublicAPI).toBe(true)

    options.onGetSuggestedQuestions('response-id')
    expect(fetchSuggestedQuestions).toHaveBeenCalledWith('response-id', 'webApp', 'test-app-id')
  })

  it('should fetch current conversation messages after new agent send completes', async () => {
    const handleSend = vi.fn()
    vi.mocked(fetchChatList).mockResolvedValue({ data: [] })
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
      chatList: [
        { id: '1', isOpeningStatement: true, content: 'Welcome', suggestedQuestions: ['Q1'] },
      ],
      suggestedQuestions: ['Q1'],
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      isNewAgent: true,
    })

    render(<ChatWrapper />)

    await userEvent.click(await screen.findByText('Q1'))

    const options = handleSend.mock.calls[0]![2]
    await options.onGetConversationMessages('conversation-1')

    expect(fetchChatList).toHaveBeenCalledWith('conversation-1', 'webApp', 'test-app-id')
  })

  it('should track the start action when a new agent web app sends a message', async () => {
    const handleSend = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
      chatList: [
        { id: '1', isOpeningStatement: true, content: 'Welcome', suggestedQuestions: ['Q1'] },
      ],
      suggestedQuestions: ['Q1'],
    } as unknown as ChatHookReturn)
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      isInstalledApp: false,
      isNewAgent: true,
    })

    render(<ChatWrapper />)

    await userEvent.click(await screen.findByText('Q1'))

    expect(handleSend).toHaveBeenCalled()
    expect(mockTrackEvent).toHaveBeenCalledWith('webapp_run', {
      app_mode: 'agent-v2',
    })
  })

  it('should track the site response mode without fetching messages for a regular web app', async () => {
    const handleSend = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
      chatList: [
        { id: '1', isOpeningStatement: true, content: 'Welcome', suggestedQuestions: ['Q1'] },
      ],
      suggestedQuestions: ['Q1'],
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      isNewAgent: false,
    })

    render(<ChatWrapper />)

    await userEvent.click(await screen.findByText('Q1'))

    const options = handleSend.mock.calls[0]![2]
    expect(options.onGetConversationMessages).toBeUndefined()
    expect(mockTrackEvent).toHaveBeenCalledWith('webapp_run', {
      app_mode: 'advanced-chat',
    })
  })

  it.each(['', '123'])(
    'switches siblings with conversation %s callbacks',
    async (conversationId) => {
      const handleSwitchSibling = vi.fn()
      const completed = vi.fn()
      setContext({
        ...defaultContextValue,
        currentConversationId: conversationId,
        handleNewConversationCompleted: completed,
      })
      vi.mocked(useChat).mockReturnValue({
        ...defaultChatHookReturn,
        handleSwitchSibling,
        chatList: [
          {
            id: 'a1',
            isAnswer: true,
            content: 'Answer',
            siblingCount: 2,
            siblingIndex: 0,
            nextSibling: 'a2',
          },
        ],
      } as ChatHookReturn)
      render(<ChatWrapper />)
      await userEvent.click(screen.getByRole('button', { name: 'Next' }))
      expect(handleSwitchSibling).toHaveBeenCalledExactlyOnceWith(
        'a2',
        expect.objectContaining({
          isPublicAPI: true,
          onConversationComplete: conversationId ? undefined : completed,
        }),
      )
      const options = handleSwitchSibling.mock.calls[0]![1]
      options.onGetSuggestedQuestions('response-id')
      expect(fetchSuggestedQuestions).toHaveBeenCalledWith('response-id', 'webApp', 'test-app-id')
      if (!conversationId) {
        options.onConversationComplete('new-conversation')
        expect(completed).toHaveBeenCalledExactlyOnceWith('new-conversation')
      }
    },
  )

  it('should handle human input form submission for installed app', async () => {
    const { submitHumanInputForm: submitWorkflowForm } = await import('@/service/workflow')
    vi.mocked(submitWorkflowForm).mockResolvedValue({})
    let resolveWorkflowEventsReady: (isReady: boolean) => void = () => {}
    const prepareHumanInputSubmission = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveWorkflowEventsReady = resolve
        }),
    )

    setContext({
      ...defaultContextValue,
      isInstalledApp: true,
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      prepareHumanInputSubmission,
      chatList: [
        { id: 'q1', content: 'Question' },
        {
          id: 'a1',
          isAnswer: true,
          content: '',
          humanInputFormDataList: [
            {
              id: 'node1',
              form_id: 'form1',
              form_token: 'token1',
              node_id: 'node1',
              node_title: 'Node 1',
              display_in_ui: true,
              form_content: '{{#$output.test#}}',
              inputs: [
                {
                  variable: 'test',
                  label: 'Test',
                  type: 'paragraph',
                  required: true,
                  output_variable_name: 'test',
                  default: { type: 'text', value: '' },
                },
              ],
              actions: [{ id: 'run', title: 'Run', button_style: 'primary' }],
            },
          ] as unknown as HumanInputFormData[],
        },
      ],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)
    expect(await screen.findByText('Node 1')).toBeInTheDocument()
    expect(chatInput()).toBeDisabled()

    const input = screen.getByRole('textbox', { name: 'test' })
    await userEvent.clear(input!)
    await userEvent.type(input!, 'test')

    const runButton = screen.getByText('Run')
    await userEvent.click(runButton)

    expect(prepareHumanInputSubmission).toHaveBeenCalledOnce()
    expect(submitWorkflowForm).not.toHaveBeenCalled()

    await act(async () => {
      resolveWorkflowEventsReady(true)
    })
    await waitFor(() => {
      expect(submitWorkflowForm).toHaveBeenCalledExactlyOnceWith('token1', {
        inputs: { test: 'test' },
        action: 'run',
      })
    })
  })

  it('should handle human input form submission for web app', async () => {
    setContext({
      ...defaultContextValue,
      isInstalledApp: false,
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [
        { id: 'q1', content: 'Question' },
        {
          id: 'a1',
          isAnswer: true,
          content: '',
          humanInputFormDataList: [
            {
              id: 'node1',
              form_id: 'form1',
              form_token: 'token-web-1',
              node_id: 'node1',
              node_title: 'Node Web 1',
              display_in_ui: true,
              form_content: '{{#$output.test#}}',
              inputs: [
                {
                  variable: 'test',
                  label: 'Test',
                  type: 'paragraph',
                  required: true,
                  output_variable_name: 'test',
                  default: { type: 'text', value: '' },
                },
              ],
              actions: [{ id: 'run', title: 'Run', button_style: 'primary' }],
            },
          ] as unknown as HumanInputFormData[],
        },
      ],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)
    expect(await screen.findByText('Node Web 1'))!.toBeInTheDocument()

    const input = screen.getByRole('textbox', { name: 'test' })
    await userEvent.clear(input!)
    await userEvent.type(input!, 'web-test')
    await userEvent.click(screen.getByText('Run'))

    await waitFor(() => {
      expect(submitHumanInputForm).toHaveBeenCalledExactlyOnceWith('token-web-1', {
        inputs: { test: 'web-test' },
        action: 'run',
      })
    })
  })

  it('should filter opening statement in new conversation with single item', () => {
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [{ id: '1', isOpeningStatement: true, content: 'Welcome' }],
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
    })

    render(<ChatWrapper />)
    expect(document.querySelector('.chat-answer-container')).not.toBeInTheDocument()
    expect(screen.getByText('Welcome'))!.toBeInTheDocument()
  })

  it('should show all messages including opening statement when there are multiple messages', () => {
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [
        { id: '1', isOpeningStatement: true, content: 'Welcome' },
        { id: '2', content: 'User message' },
      ],
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
    })

    render(<ChatWrapper />)
    const welcomeElements = screen.getAllByText('Welcome')
    expect(welcomeElements.length).toBeGreaterThan(0)
    expect(screen.getByText('User message'))!.toBeInTheDocument()
  })

  it('should show chatNode and inputs form on desktop for new conversation', () => {
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      isMobile: false,
      inputsForms: [{ variable: 'test', label: 'Test', type: 'text-input', required: false }],
    })

    render(<ChatWrapper />)
    expect(screen.getByText('Test'))!.toBeInTheDocument()
  })

  it('should show chatNode on mobile for new conversation only', () => {
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      isMobile: true,
      inputsForms: [{ variable: 'test', label: 'Test', type: 'text-input', required: false }],
    })

    const { rerender } = render(<ChatWrapper />)
    expect(screen.getByText('Test'))!.toBeInTheDocument()

    setContext({
      ...defaultContextValue,
      currentConversationId: '123',
      isMobile: true,
      inputsForms: [{ variable: 'test', label: 'Test', type: 'text-input', required: false }],
    })

    rerender(<ChatWrapper />)
    expect(screen.queryByText('Test')).not.toBeInTheDocument()
  })

  it('should not show welcome when responding', () => {
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [{ id: '1', isOpeningStatement: true, content: 'Welcome' }],
      isResponding: true,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument()
  })

  it('should not show welcome when inputs are visible and not collapsed', () => {
    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      inputsForms: [{ variable: 'test', label: 'Test', type: 'text-input', required: false }],
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [{ id: '1', isOpeningStatement: true, content: 'Welcome' }],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)
    expect(screen.queryByText('Welcome')).not.toBeInTheDocument()
  })

  it('should render answer icon when configured', () => {
    const appDataWithAnswerIcon = {
      site: {
        ...mockAppData.site,
        use_icon_as_answer_icon: true,
      },
    } as unknown as AppData

    setContext({
      ...defaultContextValue,
      appData: appDataWithAnswerIcon,
    } as ChatWithHistoryContextValue)

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [{ id: 'a1', isAnswer: true, content: 'Answer' }],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)
    expect(screen.getByText('Answer'))!.toBeInTheDocument()
    expect(screen.getByAltText('answer icon'))!.toBeInTheDocument()
  })

  it('should render question icon fallback when user avatar is available', () => {
    setContext({
      ...defaultContextValue,
      initUserVariables: {
        avatar_url: 'https://example.com/avatar.png',
        name: 'John Doe',
      },
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [{ id: 'q1', content: 'Question' }],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)
    expect(screen.getByText('J'))!.toBeInTheDocument()
  })

  it('should use fallback values for nullable appData, appMeta and avatar name', () => {
    setContext({
      ...defaultContextValue,
      appData: null as unknown as AppData,
      appMeta: null as unknown as AppMeta,
      initUserVariables: {
        avatar_url: 'https://example.com/avatar-fallback.png',
      },
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [{ id: 'q1', content: 'Question with fallback avatar name' }],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)
    expect(screen.getByText('Question with fallback avatar name'))!.toBeInTheDocument()
    expect(screen.getByText('U'))!.toBeInTheDocument()
  })

  it('keeps the chat instance stop action current after rerender', () => {
    const handleStop = vi.fn()
    const currentChatInstanceRef = {
      current: { handleStop: vi.fn() },
    } as ChatWithHistoryContextValue['currentChatInstanceRef']

    setContext({
      ...defaultContextValue,
      currentChatInstanceRef,
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleStop,
    } as unknown as ChatHookReturn)

    const { rerender } = render(<ChatWrapper />)
    currentChatInstanceRef.current.handleStop()
    expect(handleStop).toHaveBeenCalledTimes(1)
    const nextStop = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleStop: nextStop,
    } as ChatHookReturn)
    rerender(<ChatWrapper />)
    currentChatInstanceRef.current.handleStop()
    expect(nextStop).toHaveBeenCalledTimes(1)
  })

  it('should call setIsResponding when responding state changes', () => {
    const setIsResponding = vi.fn()

    setContext({
      ...defaultContextValue,
      setIsResponding,
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      isResponding: true,
    } as unknown as ChatHookReturn)

    const { rerender } = render(<ChatWrapper />)
    expect(setIsResponding).toHaveBeenCalledWith(true)

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      isResponding: false,
    } as unknown as ChatHookReturn)

    rerender(<ChatWrapper />)
    expect(setIsResponding).toHaveBeenCalledWith(false)
  })

  it('should use currentConversationInputs for existing conversation', async () => {
    const handleSend = vi.fn()
    const currentConversationInputs = { test: 'value' }

    setContext({
      ...defaultContextValue,
      currentConversationId: '123',
      currentConversationInputs,
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
      chatList: [{ id: 'q1', content: 'Question' }],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    const textarea = screen.getByRole('textbox')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'New message')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          inputs: { test: 'value' },
          query: 'New message',
          conversation_id: '123',
        }),
        expect.any(Object),
      )
    })
  })

  it('sends checkbox inputs as booleans while preserving text inputs', async () => {
    const handleSend = vi.fn()

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      inputsForms: [
        { key: 'test', name: 'Text', type: 'string' },
        { key: 'agree', name: 'Agree', type: 'checkbox' },
      ],
      newConversationInputs: { test: 'value', agree: 1 },
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    const textarea = screen.getByRole('textbox')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hello')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ inputs: { test: 'value', agree: true }, query: 'Hello' }),
        expect.any(Object),
      )
    })
  })

  it('should handle doSend with no parent message id', async () => {
    const handleSend = vi.fn()

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [], // Empty chatList
      handleSend,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    const textarea = screen.getByRole('textbox')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hello')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      // This tests line 190 - the || null part when there's no lastAnswer
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          parent_message_id: null,
        }),
        expect.any(Object),
      )
    })
  })

  it('should handle doRegenerate with editedQuestion', async () => {
    const handleSend = vi.fn()

    const mockFiles = [
      {
        id: 'file-q1',
        name: 'q1.txt',
        type: 'text/plain',
        size: 100,
        url: 'https://example.com/q1.txt',
        extension: 'txt',
        mime_type: 'text/plain',
      } as unknown as FileEntity,
    ] as FileEntity[]

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [
        { id: 'q1', content: 'Original question', message_files: mockFiles },
        { id: 'a1', isAnswer: true, content: 'Answer', parentMessageId: 'q1' },
      ],
      handleSend,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    await userEvent.click(await screen.findByRole('button', { name: 'common.operation.edit' }))
    const editedTextarea = await screen.findByDisplayValue('Original question')
    await userEvent.clear(editedTextarea)
    await userEvent.type(editedTextarea, 'Edited question text')
    await userEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          query: 'Edited question text',
          files: mockFiles,
        }),
        expect.any(Object),
      )
    })
  })

  it('should pass correct onConversationComplete for new conversation in doSend', async () => {
    const handleSend = vi.fn()
    const handleNewConversationCompleted = vi.fn()

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      handleNewConversationCompleted,
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    const textarea = screen.getByRole('textbox')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hello')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          onConversationComplete: handleNewConversationCompleted,
        }),
      )
    })
  })

  it('should pass undefined onConversationComplete for existing conversation in doSend', async () => {
    const handleSend = vi.fn()
    const handleNewConversationCompleted = vi.fn()

    setContext({
      ...defaultContextValue,
      currentConversationId: '123',
      handleNewConversationCompleted,
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
      chatList: [{ id: 'q1', content: 'Question' }],
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    const textarea = screen.getByRole('textbox')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'Hello')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          onConversationComplete: undefined,
        }),
      )
    })
  })

  it('should handle workflow resumption in new conversation', () => {
    const handleSwitchSibling = vi.fn()
    const handleNewConversationCompleted = vi.fn()

    setContext({
      ...defaultContextValue,
      currentConversationId: '',
      handleNewConversationCompleted,
      appPrevChatTree: [
        {
          id: '1',
          content: 'Answer',
          isAnswer: true,
          workflow_run_id: 'w1',
          humanInputFormDataList: [{ label: 'test' }] as unknown as HumanInputFormData[],
          children: [],
        },
      ],
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSwitchSibling,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    expect(handleSwitchSibling).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        onConversationComplete: handleNewConversationCompleted,
      }),
    )
  })

  it('should handle workflow resumption in existing conversation', () => {
    const handleSwitchSibling = vi.fn()
    const handleNewConversationCompleted = vi.fn()

    setContext({
      ...defaultContextValue,
      currentConversationId: '123',
      handleNewConversationCompleted,
      appPrevChatTree: [
        {
          id: '1',
          content: 'Answer',
          isAnswer: true,
          workflow_run_id: 'w1',
          humanInputFormDataList: [{ label: 'test' }] as unknown as HumanInputFormData[],
          children: [],
        },
      ],
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSwitchSibling,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    expect(handleSwitchSibling).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({
        onConversationComplete: undefined,
      }),
    )
  })

  it('should handle null appPrevChatTree', () => {
    const handleSwitchSibling = vi.fn()
    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      chatList: [],
      handleSwitchSibling,
    } as unknown as ChatHookReturn)

    setContext({
      ...defaultContextValue,
      appPrevChatTree: null as unknown as ChatItemInTree[], // Test null specifically for line 169
    })

    render(<ChatWrapper />)
    expect(handleSwitchSibling).not.toHaveBeenCalled()
  })

  it('should handle fallback branches for appParams, appId and empty chat instance ref', async () => {
    const handleSend = vi.fn()

    setContext({
      ...defaultContextValue,
      appParams: undefined as unknown as ChatConfig,
      appId: '',
      currentConversationId: '',
      currentChatInstanceRef: {
        current: null,
      } as unknown as ChatWithHistoryContextValue['currentChatInstanceRef'],
    })

    vi.mocked(useChat).mockReturnValue({
      ...defaultChatHookReturn,
      handleSend,
    } as unknown as ChatHookReturn)

    render(<ChatWrapper />)

    const textarea = screen.getByRole('textbox')
    await userEvent.clear(textarea)
    await userEvent.type(textarea, 'trigger fallback path')
    await userEvent.keyboard('{Enter}')

    await waitFor(() => {
      expect(handleSend).toHaveBeenCalled()
    })
  })
})
