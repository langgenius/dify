import type { ChatWrapperRefType } from '../index'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  renderWorkflowFlowComponent,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { InputVarType } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import {
  fetchSuggestedQuestions,
  stopChatMessageResponding,
} from '@/service/debug'
import ChatWrapper from '../chat-wrapper'

const mockUseChat = vi.hoisted(() => vi.fn())
const mockUseSubscription = vi.hoisted(() => vi.fn())

vi.mock('@/service/debug', () => ({
  fetchSuggestedQuestions: vi.fn(),
  stopChatMessageResponding: vi.fn(),
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
    onRegenerate?: (chatItem: { id: string, parentMessageId?: string, content?: string, message_files?: unknown[] }) => void
    switchSibling?: (siblingMessageId: string) => void
    onHumanInputFormSubmit?: (formToken: string, formData: Record<string, string>) => Promise<void>
    onFeatureBarClick?: (state: boolean) => void
  }) => (
    <div data-testid="chat-shell">
      <div data-testid="chat-input-disabled">{`${inputDisabled}`}</div>
      <button type="button" onClick={() => onSend?.('hello', [])}>send-chat</button>
      <button
        type="button"
        onClick={() => onRegenerate?.({
          id: 'answer-2',
          parentMessageId: 'question-1',
          content: 'latest answer',
          message_files: [],
        })}
      >
        regenerate-chat
      </button>
      <button type="button" onClick={() => switchSibling?.('sibling-2')}>switch-sibling</button>
      <button type="button" onClick={() => onHumanInputFormSubmit?.('token-1', { answer: 'ok' })}>submit-human-input</button>
      <button type="button" onClick={() => onFeatureBarClick?.(true)}>open-feature-panel</button>
      {chatNode}
    </div>
  ),
}))

vi.mock('../hooks', () => ({
  useChat: (...args: unknown[]) => mockUseChat(...args),
}))

vi.mock('@/app/components/base/features/hooks', () => ({
  useFeatures: <T,>(selector: (state: {
    features: {
      opening?: { enabled?: boolean, opening_statement?: string, suggested_questions?: string[] }
      suggested: boolean
      text2speech: boolean
      speech2text: boolean
      citation: boolean
      moderation: boolean
      file: { enabled: boolean }
    }
  }) => T) => selector({
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

const mockFetchSuggestedQuestions = vi.mocked(fetchSuggestedQuestions)
const mockStopChatMessageResponding = vi.mocked(stopChatMessageResponding)

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

const createChatWrapperRef = () => ({ current: null }) as unknown as React.RefObject<ChatWrapperRefType>

describe('ChatWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: {
        id: 'app-1',
        site: {
          access_token: 'site-token',
          app_base_url: 'https://example.com',
        },
      } as ReturnType<typeof useAppStore.getState>['appDetail'],
    })
    mockUseChat.mockReturnValue(createChatState())
  })

  it('seeds start defaults into workflow inputs and exposes restart through the ref handle', async () => {
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
              variables: [{
                type: InputVarType.textInput,
                variable: 'name',
                label: 'Name',
                default: 'Ada',
              }],
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

    act(() => {
      chatRef.current?.handleRestart()
    })

    expect(chatState.handleRestart).toHaveBeenCalledTimes(1)
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

    mockUseChat.mockReturnValue(createChatState({
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
            status: 'paused',
          },
        },
      ],
      handleSend,
      handleSwitchSibling,
      handleSubmitHumanInputForm,
      handleStop,
    }))

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
              variables: [{
                type: InputVarType.textInput,
                variable: 'name',
                label: 'Name',
                default: 'Ada',
              }],
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

    expect(screen.getByTestId('chat-input-disabled')).toHaveTextContent('true')

    await user.click(screen.getByRole('button', { name: 'send-chat' }))
    expect(handleSend).toHaveBeenCalledWith(expect.objectContaining({
      query: 'hello',
      conversation_id: 'conversation-1',
      inputs: {
        existing: 'value',
        name: 'Ada',
      },
      parent_message_id: 'answer-2',
    }), expect.objectContaining({
      onGetSuggestedQuestions: expect.any(Function),
    }))

    const sendCallbacks = handleSend.mock.calls[0]?.[1] as {
      onGetSuggestedQuestions: (messageId: string, getAbortController: () => AbortController) => void
    }
    sendCallbacks.onGetSuggestedQuestions('message-1', () => new AbortController())
    expect(mockFetchSuggestedQuestions).toHaveBeenCalledWith('app-1', 'message-1', expect.any(Function))

    await user.click(screen.getByRole('button', { name: 'regenerate-chat' }))
    expect(handleSend).toHaveBeenNthCalledWith(2, expect.objectContaining({
      query: 'first question',
      parent_message_id: 'answer-1',
    }), expect.any(Object))

    await user.click(screen.getByRole('button', { name: 'switch-sibling' }))
    expect(handleSwitchSibling).toHaveBeenCalledWith('sibling-2', expect.objectContaining({
      onGetSuggestedQuestions: expect.any(Function),
    }))

    const stopResponding = mockUseChat.mock.calls[0]?.[3] as (taskId: string) => void
    stopResponding('task-1')
    expect(mockStopChatMessageResponding).toHaveBeenCalledWith('app-1', 'task-1')

    await user.click(screen.getByRole('button', { name: 'submit-human-input' }))
    await waitFor(() => {
      expect(handleSubmitHumanInputForm).toHaveBeenCalledWith('token-1', { answer: 'ok' })
    })

    const subscription = mockUseSubscription.mock.calls[0]?.[0] as (payload: { type: string }) => void
    act(() => {
      subscription({ type: EVENT_WORKFLOW_STOP })
    })

    expect(handleStop).toHaveBeenCalledTimes(1)
  })

  it('collapses the side panel while the chat is responding', async () => {
    const onHide = vi.fn()
    mockUseChat.mockReturnValue(createChatState({
      isResponding: true,
    }))

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
})
