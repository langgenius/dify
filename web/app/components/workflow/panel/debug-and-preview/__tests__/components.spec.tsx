import type { ChatWrapperRefType } from '../index'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { useStore as useAppStore } from '@/app/components/app/store'
import { createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  renderWorkflowComponent,
  renderWorkflowFlowComponent,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { InputVarType } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { fetchSuggestedQuestions, stopChatMessageResponding } from '@/service/debug'
import { fetchCurrentValueOfConversationVariable } from '@/service/workflow'
import ChatWrapper from '../chat-wrapper'
import ConversationVariableModal from '../conversation-variable-modal'
import UserInput from '../user-input'

const mockUseChat = vi.fn()
const mockChatRender = vi.fn()
const mockUseSubscription = vi.fn()

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/debug', () => ({
  fetchSuggestedQuestions: vi.fn(),
  stopChatMessageResponding: vi.fn(),
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
  default: ({ value }: { value?: string }) => <pre data-testid="conversation-code-editor">{value}</pre>,
}))

vi.mock('@/app/components/workflow/nodes/_base/components/before-run-form/form-item', () => ({
  default: ({
    payload,
    value,
    onChange,
  }: {
    payload: { label?: string, variable: string }
    value?: string
    onChange: (value: string) => void
  }) => (
    <input
      aria-label={payload.label || payload.variable}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
    />
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
    onRegenerate?: (chatItem: { id: string, parentMessageId?: string, content?: string, message_files?: unknown[] }) => void
    switchSibling?: (siblingMessageId: string) => void
    onHumanInputFormSubmit?: (formToken: string, formData: Record<string, string>) => Promise<void>
    onFeatureBarClick?: (state: boolean) => void
  }) => {
    mockChatRender({
      inputDisabled,
      hasChatNode: !!chatNode,
    })
    return (
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
    )
  },
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

const mockFetchCurrentValueOfConversationVariable = vi.mocked(fetchCurrentValueOfConversationVariable)
const mockCopy = vi.mocked(copy)
const mockFetchSuggestedQuestions = vi.mocked(fetchSuggestedQuestions)
const mockStopChatMessageResponding = vi.mocked(stopChatMessageResponding)

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
  data: Array<Awaited<ReturnType<typeof fetchCurrentValueOfConversationVariable>>['data'][number]> = [],
): Awaited<ReturnType<typeof fetchCurrentValueOfConversationVariable>> => ({
  data,
  has_more: false,
  limit: 20,
  total: data.length,
  page: 1,
})

const createChatWrapperRef = () => ({ current: null }) as unknown as React.RefObject<ChatWrapperRefType>

describe('debug-and-preview components', () => {
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
    mockFetchCurrentValueOfConversationVariable.mockResolvedValue(createConversationVariableResponse())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('ConversationVariableModal', () => {
    it('should load latest values, switch variable tabs, and close the modal', async () => {
      const user = userEvent.setup()
      const onHide = vi.fn()
      mockFetchCurrentValueOfConversationVariable.mockResolvedValue(createConversationVariableResponse([
        {
          ...createConversationVariable({
            id: 'var-1',
            value: '{"latest":1}',
          }),
          updated_at: 100,
          created_at: 50,
        },
        {
          ...createConversationVariable({
            id: 'var-2',
            name: 'summary',
            value_type: ChatVarType.String,
            value: 'latest text',
          }),
          updated_at: 200,
          created_at: 150,
        },
      ]))

      renderWorkflowComponent(
        <ConversationVariableModal
          conversationID="conversation-1"
          onHide={onHide}
        />,
        {
          initialStoreState: {
            appId: 'app-1',
            conversationVariables: [
              createConversationVariable(),
              createConversationVariable({
                id: 'var-2',
                name: 'summary',
                value_type: ChatVarType.String,
                value: 'plain text',
              }),
            ],
          },
        },
      )

      await waitFor(() => {
        expect(mockFetchCurrentValueOfConversationVariable).toHaveBeenCalledWith({
          url: '/apps/app-1/conversation-variables',
          params: { conversation_id: 'conversation-1' },
        })
      })

      expect(screen.getAllByText('session_state')).toHaveLength(2)
      expect(screen.getByText(content => content.includes('formatted-100'))).toBeInTheDocument()
      expect(screen.getByTestId('conversation-code-editor')).toHaveTextContent('{"latest":1}')

      const closeTrigger = document.querySelector('.absolute.right-4.top-4.cursor-pointer') as HTMLElement

      await user.click(screen.getByText('summary'))
      expect(screen.getByText('latest text')).toBeInTheDocument()

      await user.click(closeTrigger)
      expect(onHide).toHaveBeenCalledTimes(1)
    })

    it('should copy the current variable value and reset the copied state after the timeout', async () => {
      vi.useFakeTimers()
      renderWorkflowComponent(
        <ConversationVariableModal
          conversationID="conversation-1"
          onHide={vi.fn()}
        />,
        {
          initialStoreState: {
            appId: 'app-1',
            conversationVariables: [
              createConversationVariable(),
            ],
          },
        },
      )

      const copyTrigger = document.querySelector('.flex.items-center.p-1 svg.cursor-pointer') as HTMLElement
      act(() => {
        fireEvent.click(copyTrigger)
      })
      expect(mockCopy).toHaveBeenCalledWith('{"draft":true}')

      act(() => {
        vi.advanceTimersByTime(2000)
      })
    })
  })

  describe('UserInput', () => {
    it('should hide secret fields outside the expanded panel and persist edits into workflow state', async () => {
      const user = userEvent.setup()
      const { store } = renderWorkflowFlowComponent(
        <UserInput />,
        {
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
        },
      )

      expect(screen.getByLabelText('Question')).toBeInTheDocument()
      expect(screen.queryByLabelText('Internal Note')).not.toBeInTheDocument()

      await user.clear(screen.getByLabelText('Question'))
      await user.type(screen.getByLabelText('Question'), 'updated draft')

      expect(store.getState().inputs).toEqual({
        question: 'updated draft',
      })
    })

    it('should reveal hidden fields when the debug-and-preview panel is expanded', () => {
      renderWorkflowFlowComponent(
        <UserInput />,
        {
          nodes: [
            createStartNode({
              data: {
                variables: [{
                  type: InputVarType.textInput,
                  variable: 'internal_note',
                  label: 'Internal Note',
                  hide: true,
                }],
              },
            }),
          ],
          edges: [],
          initialStoreState: {
            inputs: {},
            showDebugAndPreviewPanel: true,
          },
        },
      )

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

      expect(screen.getByText('workflow.common.previewPlaceholder')).toBeInTheDocument()

      act(() => {
        chatRef.current?.handleRestart()
      })

      expect(chatState.handleRestart).toHaveBeenCalledTimes(1)
      expect(store.getState().inputs).toEqual({
        name: 'Ada',
      })
    })

    it('should hide the side panel while responding and render the conversation modal when requested', async () => {
      const onHide = vi.fn()
      mockUseChat.mockReturnValue(createChatState({
        isResponding: true,
      }))
      mockFetchCurrentValueOfConversationVariable.mockResolvedValue(createConversationVariableResponse([
        {
          ...createConversationVariable({
            id: 'var-1',
            value: '{"latest":1}',
          }),
          updated_at: 100,
          created_at: 50,
        },
      ]))

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
          initialStoreState: {
            appId: 'app-1',
            conversationVariables: [
              createConversationVariable(),
            ],
          },
        },
      )

      await waitFor(() => {
        expect(onHide).toHaveBeenCalledTimes(1)
      })

      expect(screen.getAllByText('session_state')).toHaveLength(2)
    })

    it('should forward chat actions, stop subscriptions, and expose paused input state', async () => {
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

      const switchCallbacks = handleSwitchSibling.mock.calls[0]?.[1] as {
        onGetSuggestedQuestions: (messageId: string, getAbortController: () => AbortController) => void
      }
      switchCallbacks.onGetSuggestedQuestions('message-2', () => new AbortController())
      expect(mockFetchSuggestedQuestions).toHaveBeenCalledWith('app-1', 'message-2', expect.any(Function))

      await user.click(screen.getByRole('button', { name: 'submit-human-input' }))
      await waitFor(() => {
        expect(handleSubmitHumanInputForm).toHaveBeenCalledWith('token-1', { answer: 'ok' })
      })

      const stopResponding = mockUseChat.mock.calls[0]?.[3] as (taskId: string) => void
      stopResponding('task-1')
      expect(mockStopChatMessageResponding).toHaveBeenCalledWith('app-1', 'task-1')

      const subscription = mockUseSubscription.mock.calls[0]?.[0] as (payload: { type: string }) => void
      act(() => {
        subscription({ type: EVENT_WORKFLOW_STOP })
      })
      expect(handleStop).toHaveBeenCalledTimes(1)
    })
  })
})
