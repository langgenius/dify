import type { ChatWrapperRefType } from '../index'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { SpeechToTextTarget } from '@/app/components/base/voice-input/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { InputVarType } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import ChatWrapper from '../chat-wrapper'

const mockUseChat = vi.hoisted(() => vi.fn())
const mockUseSubscription = vi.hoisted(() => vi.fn())

const mockRequest = vi.hoisted(() => vi.fn())

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: { call: mockRequest },
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
    speechToTextTarget,
    onOpenLog,
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
    speechToTextTarget?: SpeechToTextTarget
    onOpenLog?: (item: IChatItem) => void
  }) => (
    <div
      data-testid="chat-shell"
      data-speech-app-id={
        speechToTextTarget?.type === 'consoleApp' ? speechToTextTarget.appId : undefined
      }
      data-speech-target={speechToTextTarget?.type}
    >
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
      <button
        onClick={() =>
          onOpenLog?.({ id: 'log-1', isAnswer: true, content: 'answer', workflow_run_id: 'run-1' })
        }
      >
        open-log
      </button>
      {chatNode}
    </div>
  ),
}))

vi.mock('../hooks', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: <T,>(
    selector: (state: {
      features: {
        opening?: { enabled?: boolean; opening_statement?: string; suggested_questions?: string[] }
        suggested: boolean
        text2speech: boolean
        speech2text: boolean
        citation: boolean
        moderation: boolean
        file: { enabled: boolean }
      }
    }) => T,
  ) =>
    selector({
      features: {
        opening: { enabled: false, opening_statement: '', suggested_questions: [] },
        suggested: false,
        text2speech: false,
        speech2text: false,
        citation: false,
        moderation: false,
        file: { enabled: false },
      },
    }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: mockUseSubscription,
    },
  }),
}))

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

const createChatWrapperRef = () => createRef<ChatWrapperRefType>()

describe('ChatWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: [] })
    mockUseChat.mockReturnValue(createChatState())
  })

  it('seeds start defaults into workflow inputs and exposes restart through the ref handle', async () => {
    const user = userEvent.setup()
    const chatState = createChatState()
    mockUseChat.mockReturnValue(chatState)
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

    await user.click(screen.getByRole('button', { name: 'open-log' }))
    expect(store.getState().messageLogItem?.workflow_run_id).toBe('run-1')

    act(() => {
      chatRef.current?.handleRestart()
    })

    expect(chatState.handleRestart).toHaveBeenCalledTimes(1)
    expect(store.getState().messageLogItem).toBeUndefined()
    expect(store.getState().inputs).toEqual({
      name: 'Ada',
    })
  })

  it('forwards chat actions and stops the active run when workflow-stop is emitted', async () => {
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

    const stopResponding = mockUseChat.mock.calls[0]?.[3] as (taskId: string) => void
    await stopResponding('task-1')
    expect(mockRequest).toHaveBeenCalledWith(
      ['apps', 'byAppId', 'chatMessages', 'byTaskId', 'stop', 'post'],
      { params: { app_id: 'app-1', task_id: 'task-1' } },
      expect.any(Object),
    )

    await user.click(screen.getByRole('button', { name: 'submit-human-input' }))
    await waitFor(() => {
      expect(handleSubmitHumanInputForm).toHaveBeenCalledWith('token-1', {
        inputs: { answer: 'ok' },
        action: 'approve',
      })
    })

    const subscription = mockUseSubscription.mock.calls[0]?.[0] as (payload: {
      type: string
    }) => void
    act(() => {
      subscription({ type: EVENT_WORKFLOW_STOP })
    })

    expect(handleStop).toHaveBeenCalledTimes(1)
  })

  it('disables sending while the latest workflow run is paused', async () => {
    const user = userEvent.setup()
    const chatState = createChatState({
      chatList: [
        { id: 'answer-1', isAnswer: true, content: '', workflowProcess: { status: 'paused' } },
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
      { nodes: [createStartNode()], edges: [] },
    )
    const send = screen.getByRole('button', { name: 'send-chat' })
    expect(send).toBeDisabled()
    await user.click(send)
    expect(chatState.handleSend).not.toHaveBeenCalled()
  })

  it('cancels only the requested message query through the chat cancellation callback', async () => {
    const user = userEvent.setup()
    const handleSend = vi.fn()
    mockUseChat.mockReturnValue(createChatState({ handleSend }))
    mockRequest.mockImplementation(() => new Promise(() => {}))

    renderWorkflowFlowComponent(
      <ChatWrapper
        ref={createChatWrapperRef()}
        showConversationVariableModal={false}
        onConversationModalHide={vi.fn()}
        showInputsFieldsPanel={false}
        onHide={vi.fn()}
      />,
      { nodes: [createStartNode()], edges: [] },
    )
    await user.click(screen.getByRole('button', { name: 'send-chat' }))
    const { onGetSuggestedQuestions } = handleSend.mock.calls[0]![1] as {
      onGetSuggestedQuestions: (
        messageId: string,
        onCancel: (cancel: () => void) => void,
      ) => Promise<unknown>
    }
    const onCancelFirst = vi.fn()
    const onCancelSecond = vi.fn()
    const firstRequest = onGetSuggestedQuestions('message-1', onCancelFirst)
    const firstCancelled = expect(firstRequest).rejects.toThrow()
    const secondRequest = onGetSuggestedQuestions('message-2', onCancelSecond)
    const secondCancelled = expect(secondRequest).rejects.toThrow()

    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2))
    const firstSignal = mockRequest.mock.calls[0]![2].signal as AbortSignal
    const secondSignal = mockRequest.mock.calls[1]![2].signal as AbortSignal
    onCancelFirst.mock.calls[0]![0]()
    await firstCancelled
    expect(firstSignal.aborted).toBe(true)
    expect(secondSignal.aborted).toBe(false)

    onCancelSecond.mock.calls[0]![0]()
    await secondCancelled
  })

  it('collapses the side panel while the chat is responding', async () => {
    const onHide = vi.fn()
    mockUseChat.mockReturnValue(
      createChatState({
        isResponding: true,
      }),
    )

    renderWorkflowFlowComponent(
      <ChatWrapper
        ref={createChatWrapperRef()}
        showConversationVariableModal={false}
        onConversationModalHide={vi.fn()}
        showInputsFieldsPanel={false}
        onHide={onHide}
      />,
      {
        nodes: [createStartNode()],
        edges: [],
      },
    )

    await waitFor(() => {
      expect(onHide).toHaveBeenCalledTimes(1)
    })
  })

  it('passes the workflow App target to speech-to-text', () => {
    renderWorkflowFlowComponent(
      <ChatWrapper
        ref={createChatWrapperRef()}
        showConversationVariableModal={false}
        onConversationModalHide={vi.fn()}
        showInputsFieldsPanel={false}
        onHide={vi.fn()}
      />,
      {
        nodes: [createStartNode()],
        edges: [],
      },
    )

    expect(screen.getByTestId('chat-shell')).toHaveAttribute('data-speech-target', 'consoleApp')
    expect(screen.getByTestId('chat-shell')).toHaveAttribute('data-speech-app-id', 'app-1')
  })
})
