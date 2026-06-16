import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { AgentPreviewChat } from '../chat'

const handleSendMock = vi.hoisted(() => vi.fn())
const stopCallbackRef = vi.hoisted(() => ({
  current: undefined as undefined | ((taskId: string) => void),
}))
const chatMessagesGetMock = vi.hoisted(() => vi.fn())
const suggestedQuestionsGetMock = vi.hoisted(() => vi.fn())
const stopPostMock = vi.hoisted(() => vi.fn())

vi.mock('@/next/dynamic', () => ({
  default: () => function MockChat(props: {
    onSend: (message: string) => void
    onStopResponding: () => void
  }) {
    return (
      <div>
        <button type="button" onClick={() => props.onSend('hello')}>
          send
        </button>
        <button type="button" onClick={props.onStopResponding}>
          stop
        </button>
      </div>
    )
  },
}))

vi.mock('@/app/components/base/chat/chat/hooks', () => ({
  useChat: (
    _config: unknown,
    _formSettings: unknown,
    _chatList: unknown[],
    stopCallback: (taskId: string) => void,
  ) => {
    stopCallbackRef.current = stopCallback

    return {
      chatList: [],
      setTargetMessageId: vi.fn(),
      isResponding: false,
      handleSend: handleSendMock,
      suggestedQuestions: [],
      handleStop: () => stopCallback('task-1'),
      handleAnnotationAdded: vi.fn(),
      handleAnnotationEdited: vi.fn(),
      handleAnnotationRemoved: vi.fn(),
    }
  },
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      avatar_url: '',
      name: 'User',
    },
  }),
}))

vi.mock('@/features/agent-v2/agent-composer/store-modules/model', () => ({
  useCurrentModel: () => ({
    provider: 'openai',
    model: 'gpt-4',
  }),
}))

vi.mock('@/features/agent-v2/agent-composer/store-modules/prompt', () => ({
  usePrompt: () => ['You are helpful.'],
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useTextGenerationCurrentProviderAndModelAndModelList: () => ({
    textGenerationModelList: [
      {
        provider: 'openai',
        models: [
          {
            model: 'gpt-4',
            features: [],
          },
        ],
      },
    ],
  }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    agent: {
      byAgentId: {
        chatMessages: {
          get: chatMessagesGetMock,
          byMessageId: {
            suggestedQuestions: {
              get: suggestedQuestionsGetMock,
            },
          },
          byTaskId: {
            stop: {
              post: stopPostMock,
            },
          },
        },
      },
    },
  },
}))

function renderPreviewChat(props?: Partial<ComponentProps<typeof AgentPreviewChat>>) {
  return render(
    <AgentPreviewChat
      agentId="agent-1"
      clearChatList={false}
      onClearChatListChange={vi.fn()}
      {...props}
    />,
  )
}

describe('AgentPreviewChat', () => {
  beforeEach(() => {
    handleSendMock.mockClear()
    chatMessagesGetMock.mockResolvedValue({ data: [] })
    suggestedQuestionsGetMock.mockResolvedValue({ data: [] })
    stopPostMock.mockResolvedValue({ result: 'success' })
    stopCallbackRef.current = undefined
  })

  it('should send preview chat through the agent chat endpoints', async () => {
    renderPreviewChat()

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    expect(handleSendMock).toHaveBeenCalledWith(
      'agent/agent-1/chat-messages',
      expect.not.objectContaining({
        model_config: expect.anything(),
      }),
      expect.objectContaining({
        onGetConversationMessages: expect.any(Function),
        onGetSuggestedQuestions: expect.any(Function),
      }),
    )

    const firstCall = handleSendMock.mock.calls.at(0)
    expect(firstCall).toBeDefined()

    const callbacks = firstCall![2]
    await callbacks.onGetConversationMessages('conversation-1')
    await callbacks.onGetSuggestedQuestions('message-1')

    expect(chatMessagesGetMock).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      query: {
        conversation_id: 'conversation-1',
      },
    })
    expect(suggestedQuestionsGetMock).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
        message_id: 'message-1',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'stop' }))

    expect(stopPostMock).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
        task_id: 'task-1',
      },
    })
  })
})
