import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { AgentPreviewChat } from '../chat'

const useChatMock = vi.hoisted(() => vi.fn())
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
  useChat: useChatMock.mockImplementation((
    _config: unknown,
    _formSettings: unknown,
    chatList: unknown[],
    stopCallback: (taskId: string) => void,
  ) => {
    stopCallbackRef.current = stopCallback

    return {
      chatList,
      setTargetMessageId: vi.fn(),
      isResponding: false,
      handleSend: handleSendMock,
      suggestedQuestions: [],
      handleStop: () => stopCallback('task-1'),
      handleAnnotationAdded: vi.fn(),
      handleAnnotationEdited: vi.fn(),
      handleAnnotationRemoved: vi.fn(),
    }
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    userProfile: {
      avatar_url: '',
      name: 'User',
    },
  }),
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
  const store = createStore()
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  store.set(agentComposerModelAtom, {
    provider: 'openai',
    model: 'gpt-4',
  })
  store.set(agentComposerPromptAtom, 'You are helpful.')

  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <AgentPreviewChat
          agentId="agent-1"
          clearChatList={false}
          onClearChatListChange={vi.fn()}
          {...props}
        />
      </JotaiProvider>
    </QueryClientProvider>,
  )
}

describe('AgentPreviewChat', () => {
  beforeEach(() => {
    useChatMock.mockClear()
    handleSendMock.mockClear()
    chatMessagesGetMock.mockResolvedValue({ data: [] })
    suggestedQuestionsGetMock.mockResolvedValue({ data: [] })
    stopPostMock.mockResolvedValue({ result: 'success' })
    stopCallbackRef.current = undefined
  })

  it('should initialize preview chat with the stable debug conversation history', async () => {
    chatMessagesGetMock.mockResolvedValue({
      data: [
        {
          id: 'message-1',
          conversation_id: 'debug-conversation-1',
          query: 'previous question',
          answer: 'previous answer',
          inputs: {},
          message: [],
          message_files: [],
          agent_thoughts: [],
          feedbacks: [],
          answer_tokens: 3,
          message_tokens: 2,
          provider_response_latency: 1,
          status: 'success',
          from_source: 'console',
        },
      ],
    })

    renderPreviewChat({
      debugConversationId: 'debug-conversation-1',
    })

    await waitFor(() => expect(useChatMock).toHaveBeenCalled())

    expect(chatMessagesGetMock).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
      },
      query: {
        conversation_id: 'debug-conversation-1',
      },
    })
    expect(useChatMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.arrayContaining([
        expect.objectContaining({
          id: 'question-message-1',
          content: 'previous question',
          children: expect.arrayContaining([
            expect.objectContaining({
              id: 'message-1',
              content: 'previous answer',
            }),
          ]),
        }),
      ]),
      expect.any(Function),
      false,
      expect.any(Function),
      'debug-conversation-1',
    )
  })

  it('should save draft before sending preview chat through the agent chat endpoints', async () => {
    const saveDraftBeforeRun = vi.fn().mockResolvedValue(undefined)
    renderPreviewChat({
      onSaveDraftBeforeRun: saveDraftBeforeRun,
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
    expect(saveDraftBeforeRun).toHaveBeenCalledTimes(1)
    expect(saveDraftBeforeRun.mock.invocationCallOrder[0]).toBeLessThan(handleSendMock.mock.invocationCallOrder[0]!)
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

  it('should not send preview chat when draft save fails', async () => {
    const saveDraftBeforeRun = vi.fn().mockRejectedValue(new Error('save failed'))
    renderPreviewChat({
      onSaveDraftBeforeRun: saveDraftBeforeRun,
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(saveDraftBeforeRun).toHaveBeenCalledTimes(1))
    expect(handleSendMock).not.toHaveBeenCalled()
  })
})
