import type { useChat } from '../hooks'
import type { ChatWrapperRefType } from '../index'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store/store'
import type { ConversationVariable } from '@/app/components/workflow/types'
import type { EventEmitterValue } from '@/context/event-emitter'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitter } from 'ahooks'
import copy from 'copy-to-clipboard'
import { createRef } from 'react'
import { FeaturesProvider } from '@/app/components/base/features/context'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  renderWorkflowComponent as renderWorkflowComponentBase,
  renderWorkflowFlowComponent as renderWorkflowFlowComponentBase,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { InputVarType } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { EventEmitterContext } from '@/context/event-emitter'
import { fetchCurrentValueOfConversationVariable } from '@/service/workflow'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import ChatWrapper from '../chat-wrapper'
import ConversationVariableModal from '../conversation-variable-modal'
import UserInput from '../user-input'

type RunCallbacks = NonNullable<Parameters<HooksStoreShape['handleRun']>[1]>

const mockUseChat = vi.fn<typeof useChat>()
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

vi.mock('@/service/workflow', () => ({
  fetchCurrentValueOfConversationVariable: vi.fn(),
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

// These cases isolate wrapper mapping and input policy from streaming history.
// Chat and its interactive children remain real; the stream integration below also uses real useChat.
vi.mock('../hooks', () => ({
  useChat: (...args: Parameters<typeof useChat>) => mockUseChat(...args),
}))

const Providers = ({ children }: { children: React.ReactNode }) => {
  emitter = useEventEmitter<EventEmitterValue>()
  return (
    <EventEmitterContext.Provider value={{ eventEmitter: emitter }}>
      <FeaturesProvider features={{ suggested: { enabled: true } }}>{children}</FeaturesProvider>
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

const mockFetchCurrentValueOfConversationVariable = vi.mocked(
  fetchCurrentValueOfConversationVariable,
)
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

const createChatState = (
  overrides: Partial<ReturnType<typeof useChat>> = {},
): ReturnType<typeof useChat> => ({
  conversationId: 'conversation-1',
  chatList: [],
  handleStop: vi.fn(),
  isResponding: false,
  suggestedQuestions: [],
  handleSend: vi.fn(),
  handleRestart: vi.fn(),
  handleSwitchSibling: vi.fn(),
  setTargetMessageId: vi.fn(),
  handleResume: vi.fn(),
  handleSubmitHumanInputForm: vi.fn(),
  getHumanInputNodeData: vi.fn(),
  ...overrides,
})

const createConversationVariableResponse = (
  data: Array<
    Awaited<ReturnType<typeof fetchCurrentValueOfConversationVariable>>['data'][number]
  > = [],
): Awaited<ReturnType<typeof fetchCurrentValueOfConversationVariable>> => ({
  data,
  has_more: false,
  limit: 20,
  total: data.length,
  page: 1,
})

describe('debug-and-preview components', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeParams.appId = 'app-1'
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: [] })
    mockUseChat.mockReturnValue(createChatState())
    mockFetchCurrentValueOfConversationVariable.mockResolvedValue(
      createConversationVariableResponse(),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('ConversationVariableModal', () => {
    it('copies the displayed runtime value and re-enables copying after the timeout', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      mockFetchCurrentValueOfConversationVariable.mockResolvedValue(
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
      const chatRef = createRef<ChatWrapperRefType>()

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
      const chatRef = createRef<ChatWrapperRefType>()
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
            workflowProcess: createWorkflowProcessFixture({ status: 'paused' }),
          },
        ],
      })
      mockUseChat.mockReturnValue(chatState)
      renderWorkflowFlowComponent(
        <ChatWrapper
          ref={createRef<ChatWrapperRefType>()}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />,
      )
      const input = screen.getByPlaceholderText(/common.chat.inputPlaceholder/)
      expect(input).toBeDisabled()
      await user.type(input, 'Blocked question{Enter}')
      expect(input).toHaveValue('')
      const send = screen.getByRole('button', { name: 'common.operation.send' })
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
      mockFetchCurrentValueOfConversationVariable.mockResolvedValue(
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
          ref={createRef<ChatWrapperRefType>()}
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

    it('maps real chat interactions to conversation inputs and the correct parent message', async () => {
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
              workflowProcess: createWorkflowProcessFixture(),
              siblingCount: 2,
              siblingIndex: 0,
              nextSibling: 'sibling-2',
              humanInputFormDataList: [
                createHumanInputFormFixture({
                  actions: [
                    { id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary },
                  ],
                }),
              ],
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
          ref={createRef<ChatWrapperRefType>()}
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

      await user.type(screen.getByPlaceholderText(/common.chat.inputPlaceholder/), 'hello')
      expect(screen.getByRole('button', { name: 'common.operation.send' })).toBeEnabled()

      await user.click(screen.getByRole('button', { name: 'common.operation.send' }))
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

      const regenerate = screen
        .getAllByRole('button', { name: 'common.operation.regenerate' })
        .at(-1)
      if (!regenerate) throw new Error('Expected a regenerate action for the latest answer')
      await user.click(regenerate)
      expect(handleSend).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          query: 'first question',
          parent_message_id: 'answer-1',
        }),
        expect.any(Object),
      )

      await user.click(screen.getByRole('button', { name: 'Next' }))
      expect(handleSwitchSibling).toHaveBeenCalledWith(
        'sibling-2',
        expect.objectContaining({
          onGetSuggestedQuestions: expect.any(Function),
        }),
      )

      await user.click(screen.getByRole('button', { name: 'Approve' }))
      await waitFor(() => {
        expect(handleSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
          inputs: {},
          action: 'approve',
        })
      })

      act(() => {
        emitter.emit({ type: 'unrelated-event' })
      })
      expect(handleStop).not.toHaveBeenCalled()
      act(() => {
        emitter.emit({ type: EVENT_WORKFLOW_STOP })
      })
      expect(handleStop).toHaveBeenCalledTimes(1)
    })
    it('loads suggestions after a real response and stops the active server task from the event bus', async () => {
      const { useChat: realUseChat } = await vi.importActual<typeof import('../hooks')>('../hooks')
      mockUseChat.mockImplementation(realUseChat)
      const user = userEvent.setup()
      let activeController: AbortController | undefined
      let responseCount = 0
      let stream: RunCallbacks | undefined
      const handleRun = vi.fn((_params: unknown, callbacks?: RunCallbacks) => {
        stream = callbacks
        responseCount++
        activeController = new AbortController()
        callbacks?.getAbortController?.(activeController)
        callbacks?.onData?.('Streamed answer', true, {
          conversationId: 'conversation-1',
          messageId: `answer-${responseCount}`,
          taskId: `task-${responseCount}`,
        })
      })
      mockRequest.mockResolvedValue({ data: ['Follow up'] })
      renderWorkflowFlowComponent(
        <ChatWrapper
          ref={createRef<ChatWrapperRefType>()}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />,
        { hooksStoreProps: { handleRun } },
      )
      await user.type(
        screen.getByPlaceholderText(/common.chat.inputPlaceholder/),
        'Question{Enter}',
      )
      expect(await screen.findByText('Streamed answer')).toBeInTheDocument()
      await act(async () => {
        await stream?.onCompleted?.(false)
      })
      expect(await screen.findByText('Follow up')).toBeInTheDocument()
      expect(mockRequest).toHaveBeenCalledWith(
        ['apps', 'byAppId', 'chatMessages', 'byMessageId', 'suggestedQuestions', 'get'],
        { params: { app_id: 'app-1', message_id: 'answer-1' } },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
      await user.type(
        screen.getByPlaceholderText(/common.chat.inputPlaceholder/),
        'Another question{Enter}',
      )
      expect(
        screen.getByRole('button', { name: 'appDebug.operation.stopResponding' }),
      ).toBeInTheDocument()
      act(() => emitter.emit({ type: EVENT_WORKFLOW_STOP }))
      await waitFor(() =>
        expect(mockRequest).toHaveBeenCalledWith(
          ['apps', 'byAppId', 'chatMessages', 'byTaskId', 'stop', 'post'],
          { params: { app_id: 'app-1', task_id: 'task-2' } },
          expect.any(Object),
        ),
      )
      expect(activeController?.signal.aborted).toBe(true)
      expect(screen.queryByRole('button', { name: /stopResponding/i })).not.toBeInTheDocument()
    })
  })
})
