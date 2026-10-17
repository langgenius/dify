import type { ReactElement, ReactNode } from 'react'
import type { ModelAndParameter } from '../../types'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { ChatConfig, ChatItem as ChatItemType, OnSend } from '@/app/components/base/chat/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Log from '@/app/components/base/chat/chat/log'
import { TransferMethod } from '@/app/components/base/chat/types'
import {
  ModelFeatureEnum,
  ModelTypeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { APP_CHAT_WITH_MULTIPLE_MODEL, APP_CHAT_WITH_MULTIPLE_MODEL_RESTART } from '../../types'
import ChatItem from '../chat-item'
import { DebugWithMultipleModelContextProvider } from '../context-provider'

const mockUseDebugConfigurationContext = vi.fn()
const modelListResponse = vi.fn()
const mockUseFeatures = vi.fn()
const mockUseConfigFromDebugContext = vi.fn()
const mockUseFormattingChangedSubscription = vi.fn()
const mockUseChat = vi.fn()
const mockFetchConversationMessages = vi.fn()
const mockFetchSuggestedQuestions = vi.fn()
const mockStopChatMessageResponding = vi.fn()
const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

let capturedChatProps: {
  onOpenLog: (item: IChatItem) => void
  config: ChatConfig
  chatList: ChatItemType[]
  isResponding: boolean
  onSend: OnSend
  suggestedQuestions: string[]
  allToolIcons: Record<string, string | undefined>
} | null = null

let emitDebugEvent: ((v: { type: string; payload?: Record<string, unknown> }) => void) | null = null

vi.mock('@/context/debug-configuration', () => ({
  useDebugConfigurationContext: () => mockUseDebugConfigurationContext(),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: (selector: (state: Record<string, unknown>) => unknown) => mockUseFeatures(selector),
}))

vi.mock('../../hooks', () => ({
  useConfigFromDebugContext: () => mockUseConfigFromDebugContext(),
  useFormattingChangedSubscription: (chatList: ChatItemType[]) =>
    mockUseFormattingChangedSubscription(chatList),
}))

vi.mock('@/app/components/base/chat/chat/hooks', () => ({
  useChat: () => mockUseChat(),
}))

vi.mock('@/service/debug', () => ({
  fetchConversationMessages: (...args: unknown[]) => mockFetchConversationMessages(...args),
  fetchSuggestedQuestions: (...args: unknown[]) => mockFetchSuggestedQuestions(...args),
  stopChatMessageResponding: (...args: unknown[]) => mockStopChatMessageResponding(...args),
}))

vi.mock('@/app/components/app/configuration/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/app/components/base/chat/chat', () => ({
  default: (props: typeof capturedChatProps) => {
    capturedChatProps = props
    return (
      <div data-testid="chat-component">
        {props?.chatList[0] && <Log logItem={props.chatList[0]} onOpenLog={props.onOpenLog} />}
        <span data-testid="chat-list-length">{props?.chatList?.length || 0}</span>
        <span data-testid="is-responding">{props?.isResponding ? 'yes' : 'no'}</span>
        <button
          data-testid="send-button"
          onClick={() =>
            props?.onSend?.('test message', [
              {
                id: 'file-1',
                name: 'test.txt',
                size: 100,
                type: 'text/plain',
                progress: 100,
                transferMethod: TransferMethod.local_file,
                supportFileType: 'document',
              },
            ])
          }
        >
          Send
        </button>
      </div>
    )
  },
}))

function EventSource({ children }: { children: ReactNode }) {
  const { eventEmitter } = useEventEmitterContextContext()
  emitDebugEvent = (event) => eventEmitter!.emit(event)
  return children
}

function render(ui: ReactElement) {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryOptions({
      input: { params: { model_type: ModelTypeEnum.textGeneration } },
    }).queryKey,
    modelListResponse(),
  )
  return renderWithConsoleQuery(
    <EventEmitterContextProvider>
      <EventSource>{ui}</EventSource>
    </EventEmitterContextProvider>,
    { queryClient },
  )
}

const createModelAndParameter = (
  overrides: Partial<ModelAndParameter> = {},
): ModelAndParameter => ({
  id: 'model-1',
  model: 'gpt-3.5-turbo',
  provider: 'openai',
  parameters: { temperature: 0.7 },
  ...overrides,
})

const createDefaultMocks = () => {
  mockUseDebugConfigurationContext.mockReturnValue({
    modelConfig: {
      configs: { prompt_variables: [] },
      agentConfig: { tools: [] },
    },
    appId: 'app-123',
    inputs: { key: 'value' },
    collectionList: [],
    canTestAndRun: true,
  })

  modelListResponse.mockReturnValue({
    data: [
      {
        provider: 'openai',
        models: [
          {
            model: 'gpt-3.5-turbo',
            features: [ModelFeatureEnum.vision],
            model_properties: { mode: 'chat' },
          },
        ],
      },
    ],
  })

  mockUseFeatures.mockImplementation((selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      features: {
        moreLikeThis: { enabled: false },
        opening: { enabled: true, opening_statement: 'Hello!', suggested_questions: ['Q1'] },
        moderation: { enabled: false },
        speech2text: { enabled: true },
        text2speech: { enabled: false },
        file: { enabled: true },
        suggested: { enabled: true },
        citation: { enabled: false },
        annotationReply: { enabled: false },
      },
    }
    return selector(state)
  })

  mockUseConfigFromDebugContext.mockReturnValue({
    base_config: 'test',
  })

  mockUseChat.mockReturnValue({
    chatList: [{ id: 'msg-1', content: 'Hello', isAnswer: true }],
    isResponding: false,
    handleSend: vi.fn(),
    suggestedQuestions: ['Question 1', 'Question 2'],
    handleRestart: vi.fn(),
  })
}

const renderComponent = (props: Partial<{ modelAndParameter: ModelAndParameter }> = {}) => {
  const defaultProps = {
    modelAndParameter: createModelAndParameter(),
    ...props,
  }
  return render(<ChatItem {...defaultProps} />)
}

describe('ChatItem', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    capturedChatProps = null
    emitDebugEvent = null
    createDefaultMocks()
  })

  it('opens this model result through the owning debug session', async () => {
    const user = userEvent.setup()
    const onOpenLog = vi.fn()
    render(
      <DebugWithMultipleModelContextProvider
        multipleModelConfigs={[]}
        onMultipleModelConfigsChange={vi.fn()}
        onDebugWithMultipleModelChange={vi.fn()}
        onOpenLog={onOpenLog}
      >
        <ChatItem modelAndParameter={createModelAndParameter()} />
      </DebugWithMultipleModelContextProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.log' }))
    expect(onOpenLog).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'msg-1', isAnswer: true }),
    )
  })

  describe('rendering', () => {
    it('should not render when chatList is empty', () => {
      mockUseChat.mockReturnValue({
        chatList: [],
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      expect(screen.queryByTestId('chat-component')).not.toBeInTheDocument()
    })

    it('should pass correct config to Chat', () => {
      renderComponent()

      expect(capturedChatProps?.config).toMatchObject({
        base_config: 'test',
        opening_statement: 'Hello!',
        suggested_questions: ['Q1'],
      })
    })
  })

  describe('config composition', () => {
    it('should use empty opening statement when disabled', () => {
      mockUseFeatures.mockImplementation(
        (selector: (state: Record<string, unknown>) => unknown) => {
          const state = {
            features: {
              moreLikeThis: { enabled: false },
              opening: { enabled: false, opening_statement: 'Should not appear' },
              moderation: { enabled: false },
              speech2text: { enabled: false },
              text2speech: { enabled: false },
              file: { enabled: false },
              suggested: { enabled: false },
              citation: { enabled: false },
              annotationReply: { enabled: false },
            },
          }
          return selector(state)
        },
      )

      renderComponent()

      expect(capturedChatProps?.config.opening_statement).toBe('')
      expect(capturedChatProps?.config.suggested_questions).toEqual([])
    })
  })

  describe('event subscription', () => {
    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL event', () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      // Trigger the event
      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [{ id: 'file-1' }] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        'apps/app-123/chat-messages',
        expect.objectContaining({
          query: 'Hello',
          inputs: { key: 'value' },
          files: [{ id: 'file-1' }],
        }),
        expect.objectContaining({
          onNotifyError: expect.any(Function),
        }),
      )

      const callbacks = handleSend.mock.calls[0]![2] as {
        onNotifyError: (message: string) => void
      }
      callbacks.onNotifyError('Base model not found')
      expect(mockToastError).toHaveBeenCalledWith('Base model not found')
    })

    it('should handle APP_CHAT_WITH_MULTIPLE_MODEL_RESTART event', () => {
      const handleRestart = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend: vi.fn(),
        suggestedQuestions: [],
        handleRestart,
      })

      renderComponent()

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL_RESTART,
      })

      expect(handleRestart).toHaveBeenCalled()
    })

    it('should ignore unrelated events', () => {
      const handleSend = vi.fn()
      const handleRestart = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart,
      })

      renderComponent()

      emitDebugEvent?.({
        type: 'SOME_OTHER_EVENT',
        payload: {},
      })

      expect(handleSend).not.toHaveBeenCalled()
      expect(handleRestart).not.toHaveBeenCalled()
    })
  })

  describe('doSend function', () => {
    it('should not include files when vision is not supported', () => {
      modelListResponse.mockReturnValue({
        data: [
          {
            provider: 'openai',
            models: [
              {
                model: 'gpt-3.5-turbo',
                features: [], // No vision support
                model_properties: { mode: 'chat' },
              },
            ],
          },
        ],
      })

      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [{ id: 'file-1' }] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.not.objectContaining({
          files: expect.anything(),
        }),
        expect.any(Object),
      )
    })

    it('should include model configuration in request', () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [{ id: 'msg-1' }],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      const modelAndParameter = createModelAndParameter({
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        parameters: { temperature: 0.5 },
      })

      renderComponent({ modelAndParameter })

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          model_config: expect.objectContaining({
            model: expect.objectContaining({
              provider: 'openai',
              name: 'gpt-3.5-turbo',
              completion_params: { temperature: 0.5 },
            }),
          }),
        }),
        expect.any(Object),
      )
    })

    it('should use parent_message_id from last answer', () => {
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue({
        chatList: [
          { id: 'msg-1', content: 'Hi', isAnswer: false },
          { id: 'msg-2', content: 'Hello', isAnswer: true },
        ],
        isResponding: false,
        handleSend,
        suggestedQuestions: [],
        handleRestart: vi.fn(),
      })

      renderComponent()

      emitDebugEvent?.({
        type: APP_CHAT_WITH_MULTIPLE_MODEL,
        payload: { message: 'Hello', files: [] },
      })

      expect(handleSend).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          parent_message_id: 'msg-2',
        }),
        expect.any(Object),
      )
    })
  })

  describe('allToolIcons', () => {
    it('should compute tool icons from collectionList', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          configs: { prompt_variables: [] },
          agentConfig: {
            tools: [
              { tool_name: 'tool1', provider_id: 'collection1' },
              { tool_name: 'tool2', provider_id: 'collection2' },
            ],
          },
        },
        appId: 'app-123',
        inputs: {},
        collectionList: [
          { id: 'collection1', icon: 'icon1' },
          { id: 'collection2', icon: 'icon2' },
        ],
        canTestAndRun: true,
      })

      renderComponent()

      expect(capturedChatProps?.allToolIcons).toEqual({
        tool1: 'icon1',
        tool2: 'icon2',
      })
    })

    it('should handle tools without matching collection', () => {
      mockUseDebugConfigurationContext.mockReturnValue({
        modelConfig: {
          configs: { prompt_variables: [] },
          agentConfig: {
            tools: [{ tool_name: 'tool1', provider_id: 'nonexistent' }],
          },
        },
        appId: 'app-123',
        inputs: {},
        collectionList: [],
        canTestAndRun: true,
      })

      renderComponent()

      expect(capturedChatProps?.allToolIcons).toEqual({
        tool1: undefined,
      })
    })
  })
})
