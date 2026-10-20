import type { PaginatedConversationVariableResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ChatWrapperRefType } from '../index'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { ConversationVariable } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitter } from 'ahooks'
import copy from 'copy-to-clipboard'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  renderWorkflowComponent as renderWorkflowComponentBase,
  renderWorkflowFlowComponent as renderWorkflowFlowComponentBase,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { InputVarType } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { EventEmitterContext } from '@/context/event-emitter'
import ChatWrapper from '../chat-wrapper'
import ConversationVariableModal from '../conversation-variable-modal'
import UserInput from '../user-input'

const mockUseChat = vi.fn()
const mockChatRender = vi.fn()
let emitter: ReturnType<typeof useEventEmitter<EventEmitterValue>>

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

const routeParams = vi.hoisted(() => ({ appId: 'app-1' }))
const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => routeParams,
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value?: string }) => (
    <pre data-testid="conversation-code-editor">{value}</pre>
  ),
}))

vi.mock('@/app/components/base/chat/chat', () => ({
  default: ({
    chatNode,
    inputDisabled,
    onSend,
    onRegenerate,
    switchSibling,
    onHumanInputFormSubmit,
    onFeatureBarClick,
  }: {
    chatNode: React.ReactNode
    inputDisabled?: boolean
    onSend?: (message: string, files: unknown[]) => void
    onRegenerate?: (chatItem: {
      id: string
      parentMessageId?: string
      content?: string
      message_files?: unknown[]
    }) => void
    switchSibling?: (siblingMessageId: string) => void
    onHumanInputFormSubmit?: (
      formToken: string,
      formData: { inputs: Record<string, HumanInputFieldValue>; action: string },
    ) => Promise<void>
    onFeatureBarClick?: (state: boolean) => void
  }) => {
    mockChatRender({
      inputDisabled,
      hasChatNode: !!chatNode,
    })
    return (
      <div data-testid="chat-shell">
        <div data-testid="chat-input-disabled">{`${inputDisabled}`}</div>
        <button type="button" disabled={inputDisabled} onClick={() => onSend?.('hello', [])}>
          send-chat
        </button>
        <button
          type="button"
          onClick={() =>
            onRegenerate?.({
              id: 'answer-2',
              parentMessageId: 'question-1',
              content: 'latest answer',
              message_files: [],
            })
          }
        >
          regenerate-chat
        </button>
        <button type="button" onClick={() => switchSibling?.('sibling-2')}>
          switch-sibling
        </button>
        <button
          type="button"
          onClick={() =>
            onHumanInputFormSubmit?.('token-1', { inputs: { answer: 'ok' }, action: 'approve' })
          }
        >
          submit-human-input
        </button>
        <button type="button" onClick={() => onFeatureBarClick?.(true)}>
          open-feature-panel
        </button>
        {chatNode}
      </div>
    )
  },
}))

vi.mock('../hooks', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args),
}))

const Providers = ({ children }: { children: React.ReactNode }) => {
  emitter = useEventEmitter<EventEmitterValue>()
  return (
    <EventEmitterContext.Provider value={{ eventEmitter: emitter }}>
      <FeaturesProvider>{children}</FeaturesProvider>
    </EventEmitterContext.Provider>
  )
}
const renderWorkflowComponent = (
  ui: React.ReactElement,
  options?: Parameters<typeof renderWorkflowComponentBase>[1],
) => renderWorkflowComponentBase(<Providers>{ui}</Providers>, options)
const renderWorkflowFlowComponent = (
  ui: React.ReactElement,
  options?: Parameters<typeof renderWorkflowFlowComponentBase>[1],
) => renderWorkflowFlowComponentBase(<Providers>{ui}</Providers>, options)

const mockCopy = vi.mocked(copy)

const createConversationVariable = (
  overrides: Partial<ConversationVariable> = {},
): ConversationVariable => ({
  id: 'var-1',
  name: 'session_state',
  description: 'Session state',
  value_type: ChatVarType.Object,
  value: '{"draft":true}',
  ...overrides,
})

const createChatState = (overrides: Record<string, unknown> = {}) => ({
  conversationId: 'conversation-1',
  chatList: [],
  handleStop: vi.fn(),
  isResponding: false,
  suggestedQuestions: [],
  handleSend: vi.fn(),
  handleRestart: vi.fn(),
  handleSwitchSibling: vi.fn(),
  handleSubmitHumanInputForm: vi.fn(),
  getHumanInputNodeData: vi.fn(),
  ...overrides,
})

const createConversationVariableResponse = (
  data: PaginatedConversationVariableResponse['data'] = [],
): PaginatedConversationVariableResponse => ({
  data,
  has_more: false,
  limit: 20,
  total: data.length,
  page: 1,
})

const createChatWrapperRef = () =>
  ({ current: null }) as unknown as React.RefObject<ChatWrapperRefType>

describe('debug-and-preview components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeParams.appId = 'app-1'
    mockRequest.mockReset()
    mockUseChat.mockReturnValue(createChatState())
    mockRequest.mockResolvedValue(createConversationVariableResponse())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('ConversationVariableModal', () => {
    it('copies the displayed runtime value and re-enables copying after the timeout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockRequest.mockResolvedValue(
        createConversationVariableResponse([
          {
            ...createConversationVariable({ value: '{"latest":true}' }),
            updated_at: 100,
            created_at: 50,
          },
        ]),
      )
      renderWorkflowComponent(
        <ConversationVariableModal conversationID="conversation-1" onHide={vi.fn()} />,
        {
          resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
          initialStoreState: {
            conversationVariables: [createConversationVariable()],
          },
        },
      )

      await waitFor(() =>
        expect(screen.getByTestId('conversation-code-editor')).toHaveTextContent('{"latest":true}'),
      )
      const copyTrigger = screen.getByRole('button', { name: 'common.operation.copy' })
      await user.click(copyTrigger)
      expect(mockCopy).toHaveBeenCalledExactlyOnceWith('{"latest":true}')
      expect(copyTrigger).toHaveAttribute('aria-disabled', 'true')
      await user.click(copyTrigger)
      expect(mockCopy).toHaveBeenCalledTimes(1)

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(copyTrigger).toHaveAttribute('aria-disabled', 'false')
      await user.click(copyTrigger)
      expect(mockCopy).toHaveBeenCalledTimes(2)
    })
  })

  describe('UserInput', () => {
    it('should hide secret fields outside the expanded panel and persist edits into workflow state', async () => {
      const user = userEvent.setup()
      const { store } = renderWorkflowFlowComponent(<UserInput />, {
        nodes: [
          createStartNode({
            data: {
              variables: [
                {
                  type: InputVarType.textInput,
                  variable: 'question',
                  label: 'Question',
                },
                {
                  type: InputVarType.textInput,
                  variable: 'internal_note',
                  label: 'Internal Note',
                  hide: true,
                },
              ],
            },
          }),
        ],
        edges: [],
        initialStoreState: {
          inputs: {
            question: 'draft',
          },
          showDebugAndPreviewPanel: false,
        },
      })

      expect(screen.getByLabelText('Question')).toBeInTheDocument()
      expect(screen.queryByLabelText('Internal Note')).not.toBeInTheDocument()

      await user.clear(screen.getByLabelText('Question'))
      await user.type(screen.getByLabelText('Question'), 'updated draft')

      expect(store.getState().inputs).toEqual({
        question: 'updated draft',
      })
    })

    it('should reveal hidden fields when the debug-and-preview panel is expanded', () => {
      renderWorkflowFlowComponent(<UserInput />, {
        nodes: [
          createStartNode({
            data: {
              variables: [
                {
                  type: InputVarType.textInput,
                  variable: 'internal_note',
                  label: 'Internal Note',
                  hide: true,
                },
              ],
            },
          }),
        ],
        edges: [],
        initialStoreState: {
          inputs: {},
          showDebugAndPreviewPanel: true,
        },
      })

      expect(screen.getByLabelText('Internal Note')).toBeInTheDocument()
    })
  })

  describe('ChatWrapper', () => {
    it('should seed start defaults into workflow inputs and expose restart through the ref handle', async () => {
      const chatState = createChatState()
      mockUseChat.mockReturnValue(chatState)
      const chatRef = createChatWrapperRef()

      const { store } = renderWorkflowFlowComponent(
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel
          onHide={vi.fn()}
        />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [
                  {
                    type: InputVarType.textInput,
                    variable: 'name',
                    label: 'Name',
                    default: 'Ada',
                  },
                ],
              },
            }),
          ],
          edges: [],
          initialStoreState: {
            inputs: {
              custom: 'value',
            },
          },
        },
      )

      await waitFor(() => {
        expect(store.getState().inputs).toEqual({
          custom: 'value',
          name: 'Ada',
        })
      })

      expect(screen.getByText('workflow.common.previewPlaceholder')).toBeInTheDocument()

      act(() => {
        chatRef.current?.handleRestart()
      })

      expect(chatState.handleRestart).toHaveBeenCalledTimes(1)
      expect(store.getState().inputs).toEqual({
        name: 'Ada',
      })
    })

    it('preserves zero and false start defaults when initializing and restarting', async () => {
      const chatRef = createChatWrapperRef()
      const { store } = renderWorkflowFlowComponent(
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [
                  { variable: 'count', label: 'Count', type: InputVarType.number, default: 0 },
                  {
                    variable: 'ready',
                    label: 'Ready',
                    type: InputVarType.checkbox,
                    default: false,
                  },
                ],
              },
            }),
          ],
        },
      )
      await waitFor(() => expect(store.getState().inputs).toEqual({ count: 0, ready: false }))
      act(() => store.getState().setInputs({ count: 8, ready: true }))
      act(() => chatRef.current?.handleRestart())
      expect(store.getState().inputs).toEqual({ count: 0, ready: false })
    })

    it('disables sending while the latest workflow is paused', async () => {
      const user = userEvent.setup()
      const chatState = createChatState({
        chatList: [
          {
            id: 'paused-answer',
            isAnswer: true,
            content: '',
            workflowProcess: { status: 'paused' },
          },
        ],
      })
      mockUseChat.mockReturnValue(chatState)
      renderWorkflowFlowComponent(
        <ChatWrapper
          ref={createChatWrapperRef()}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />,
      )
      const send = screen.getByRole('button', { name: 'send-chat' })
      expect(send).toBeDisabled()
      await user.click(send)
      expect(chatState.handleSend).not.toHaveBeenCalled()
    })

    it('should hide the side panel while responding and render the conversation modal when requested', async () => {
      const onHide = vi.fn()
      mockUseChat.mockReturnValue(
        createChatState({
          isResponding: true,
        }),
      )
      mockRequest.mockResolvedValue(
        createConversationVariableResponse([
          {
            ...createConversationVariable({
              id: 'var-1',
              value: '{"latest":1}',
            }),
            updated_at: 100,
            created_at: 50,
          },
        ]),
      )

      renderWorkflowFlowComponent(
        <ChatWrapper
          ref={createChatWrapperRef()}
          showConversationVariableModal
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={onHide}
        />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [],
              },
            }),
          ],
          edges: [],
          resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
          initialStoreState: {
            conversationVariables: [createConversationVariable()],
          },
        },
      )

      await waitFor(() => {
        expect(onHide).toHaveBeenCalledTimes(1)
      })

      expect(screen.getAllByText('session_state')).toHaveLength(2)
    })

    it('forwards chat actions and responds to real stop events', async () => {
      const user = userEvent.setup()
      const handleSend = vi.fn()
      const handleSwitchSibling = vi.fn()
      const handleSubmitHumanInputForm = vi.fn().mockResolvedValue(undefined)
      const handleStop = vi.fn()
      mockUseChat.mockReturnValue(
        createChatState({
          chatList: [
            {
              id: 'answer-1',
              isAnswer: true,
              content: 'first answer',
            },
            {
              id: 'question-1',
              isAnswer: false,
              content: 'first question',
              parentMessageId: 'answer-1',
              message_files: [],
            },
            {
              id: 'answer-2',
              isAnswer: true,
              parentMessageId: 'question-1',
              content: 'latest answer',
              workflowProcess: {
                status: 'succeeded',
              },
            },
          ],
          handleSend,
          handleSwitchSibling,
          handleSubmitHumanInputForm,
          handleStop,
        }),
      )

      const { store } = renderWorkflowFlowComponent(
        <ChatWrapper
          ref={createChatWrapperRef()}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [
                  {
                    type: InputVarType.textInput,
                    variable: 'name',
                    label: 'Name',
                    default: 'Ada',
                  },
                ],
              },
            }),
          ],
          edges: [],
          initialStoreState: {
            inputs: {
              existing: 'value',
            },
          },
        },
      )

      await waitFor(() => {
        expect(store.getState().inputs).toEqual({
          existing: 'value',
          name: 'Ada',
        })
      })

      expect(screen.getByRole('button', { name: 'send-chat' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'send-chat' }))
      expect(handleSend).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'hello',
          conversation_id: 'conversation-1',
          inputs: {
            existing: 'value',
            name: 'Ada',
          },
          parent_message_id: 'answer-2',
        }),
        expect.objectContaining({
          onGetSuggestedQuestions: expect.any(Function),
        }),
      )

      const sendCallbacks = handleSend.mock.calls[0]?.[1] as {
        onGetSuggestedQuestions: (messageId: string, onCancel: (cancel: () => void) => void) => void
      }
      await sendCallbacks.onGetSuggestedQuestions('message-1', () => {})
      expect(mockRequest).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'chatMessages', 'byMessageId', 'suggestedQuestions', 'get'],
        { params: { app_id: 'app-1', message_id: 'message-1' } },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )

      await user.click(screen.getByRole('button', { name: 'regenerate-chat' }))
      expect(handleSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          query: 'first question',
          parent_message_id: 'answer-1',
        }),
        expect.any(Object),
      )

      await user.click(screen.getByRole('button', { name: 'switch-sibling' }))
      expect(handleSwitchSibling).toHaveBeenCalledWith(
        'sibling-2',
        expect.objectContaining({
          onGetSuggestedQuestions: expect.any(Function),
        }),
      )

      const switchCallbacks = handleSwitchSibling.mock.calls[0]?.[1] as {
        onGetSuggestedQuestions: (messageId: string, onCancel: (cancel: () => void) => void) => void
      }
      await switchCallbacks.onGetSuggestedQuestions('message-2', () => {})
      expect(mockRequest).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'chatMessages', 'byMessageId', 'suggestedQuestions', 'get'],
        { params: { app_id: 'app-1', message_id: 'message-2' } },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )

      await user.click(screen.getByRole('button', { name: 'submit-human-input' }))
      await waitFor(() => {
        expect(handleSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
          inputs: { answer: 'ok' },
          action: 'approve',
        })
      })

      const stopResponding = mockUseChat.mock.calls[0]?.[3] as (taskId: string) => void
      await stopResponding('task-1')
      expect(mockRequest).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'chatMessages', 'byTaskId', 'stop', 'post'],
        { params: { app_id: 'app-1', task_id: 'task-1' } },
        expect.any(Object),
      )

      act(() => {
        emitter.emit({ type: 'unrelated-event' })
      })
      expect(handleStop).not.toHaveBeenCalled()
      act(() => {
        emitter.emit({ type: EVENT_WORKFLOW_STOP })
      })
      expect(handleStop).toHaveBeenCalledTimes(1)
    })
  })
})
