import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { useState } from 'react'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { agentComposerModelAtom } from '@/features/agent-v2/agent-composer/store-modules/model'
import { agentComposerPromptAtom } from '@/features/agent-v2/agent-composer/store-modules/prompt'
import { consoleQuery } from '@/service/client'
import { TransferMethod } from '@/types/app'
import { AgentChatRuntime } from '../chat-runtime'

const useChatMock = vi.hoisted(() => vi.fn())
const handleSendMock = vi.hoisted(() => vi.fn())
const stopCallbackRef = vi.hoisted(() => ({
  current: undefined as undefined | ((taskId: string) => void),
}))
const sendResultRef = vi.hoisted(() => ({
  current: undefined as unknown,
}))
const chatMessagesGetMock = vi.hoisted(() => vi.fn())
const suggestedQuestionsGetMock = vi.hoisted(() => vi.fn())
const stopPostMock = vi.hoisted(() => vi.fn())

vi.mock('@/next/dynamic', async () => {
  const { useState } = await import('react')

  return {
    default: () => function MockChat(props: {
      onSend: (message: string) => unknown
      onStopResponding: () => void
      sendButtonLabel?: string
      sendButtonLoading?: boolean
    }) {
      const [sent, setSent] = useState(false)

      return (
        <div
          data-testid="mock-chat"
          data-send-button-label={props.sendButtonLabel ?? ''}
          data-send-button-loading={String(!!props.sendButtonLoading)}
        >
          <span>{`sessionSent:${sent ? 'yes' : 'no'}`}</span>
          <button
            type="button"
            onClick={() => {
              setSent(true)
              sendResultRef.current = props.onSend('hello')
            }}
          >
            send
          </button>
          <button type="button" onClick={props.onStopResponding}>
            stop
          </button>
        </div>
      )
    },
  }
})

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

vi.mock('@/service/client', async () => {
  const { skipToken } = await import('@tanstack/react-query')
  const getChatMessagesQueryKey = (input: unknown) => ['agent-chat-conversation-messages', input]

  return {
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
    consoleQuery: {
      agent: {
        byAgentId: {
          chatMessages: {
            get: {
              queryKey: ({ input }: { input: unknown }) => getChatMessagesQueryKey(input),
              queryOptions: ({ input }: { input: unknown }) => ({
                queryKey: getChatMessagesQueryKey(input),
                queryFn: input === skipToken ? skipToken : () => chatMessagesGetMock(input),
              }),
            },
          },
        },
      },
    },
  }
})

function renderPreviewChat(props?: Partial<ComponentProps<typeof AgentChatRuntime>>) {
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

  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <AgentChatRuntime
            agentId="agent-1"
            clearChatList={false}
            inputPlaceholder="Message agent"
            renderEmptyState={() => null}
            onClearChatListChange={vi.fn()}
            {...props}
          />
        </JotaiProvider>
      </QueryClientProvider>,
    ),
  }
}

function RuntimeConversationHarness() {
  const [conversationId, setConversationId] = useState<string | null>(null)

  return (
    <AgentChatRuntime
      agentId="agent-1"
      clearChatList={false}
      conversationId={conversationId}
      inputPlaceholder="Message agent"
      renderEmptyState={() => null}
      onClearChatListChange={vi.fn()}
      onConversationIdChange={setConversationId}
    />
  )
}

function RuntimeClearCommandHarness({
  inputPlaceholder,
}: {
  inputPlaceholder: string
}) {
  const [clearChatList, setClearChatList] = useState(true)

  return (
    <AgentChatRuntime
      agentId="agent-1"
      clearChatList={clearChatList}
      inputPlaceholder={inputPlaceholder}
      renderEmptyState={() => null}
      onClearChatListChange={setClearChatList}
    />
  )
}

function renderPreviewChatWithConversationHarness() {
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
        <RuntimeConversationHarness />
      </JotaiProvider>
    </QueryClientProvider>,
  )
}

function renderPreviewChatWithClearCommandHarness() {
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

  const renderHarness = (inputPlaceholder: string) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <RuntimeClearCommandHarness inputPlaceholder={inputPlaceholder} />
      </JotaiProvider>
    </QueryClientProvider>
  )

  return {
    ...render(renderHarness('Message agent')),
    renderHarness,
  }
}

describe('AgentPreviewChat', () => {
  beforeEach(() => {
    useChatMock.mockClear()
    handleSendMock.mockClear()
    chatMessagesGetMock.mockResolvedValue({ data: [] })
    suggestedQuestionsGetMock.mockResolvedValue({ data: [] })
    stopPostMock.mockResolvedValue({ result: 'success' })
    stopCallbackRef.current = undefined
    sendResultRef.current = undefined
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
      conversationId: 'debug-conversation-1',
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

  it('should show the send button loading state while preparing a build run', async () => {
    let resolveSaveDraftBeforeRun: () => void = () => {}
    const saveDraftBeforeRun = vi.fn(() => new Promise<void>((resolve) => {
      resolveSaveDraftBeforeRun = resolve
    }))
    renderPreviewChat({
      sendButtonLabel: 'Start build',
      renderEmptyState: ({ inputNode }) => <div>{inputNode}</div>,
      onSaveDraftBeforeRun: saveDraftBeforeRun,
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    expect(saveDraftBeforeRun).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByTestId('mock-chat')).toHaveAttribute('data-send-button-loading', 'true')
    })
    expect(handleSendMock).not.toHaveBeenCalled()

    await act(async () => {
      resolveSaveDraftBeforeRun()
    })
    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
  })

  it('should not show the send button loading state while an icon send button prepares the run', async () => {
    const saveDraftBeforeRun = vi.fn(() => new Promise<void>(() => {}))
    renderPreviewChat({
      onSaveDraftBeforeRun: saveDraftBeforeRun,
    })

    await waitFor(() => expect(screen.getByTestId('mock-chat')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    expect(saveDraftBeforeRun).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.getByTestId('mock-chat')).toHaveAttribute('data-send-button-loading', 'false')
    })
    expect(handleSendMock).not.toHaveBeenCalled()
  })

  it('should not show the send button loading state while an icon send button is responding', async () => {
    useChatMock.mockImplementationOnce((
      _config: unknown,
      _formSettings: unknown,
      chatList: unknown[],
      stopCallback: (taskId: string) => void,
    ) => {
      stopCallbackRef.current = stopCallback

      return {
        chatList,
        setTargetMessageId: vi.fn(),
        isResponding: true,
        handleSend: handleSendMock,
        suggestedQuestions: [],
        handleStop: () => stopCallback('task-1'),
        handleAnnotationAdded: vi.fn(),
        handleAnnotationEdited: vi.fn(),
        handleAnnotationRemoved: vi.fn(),
      }
    })

    renderPreviewChat()

    await waitFor(() => expect(screen.getByTestId('mock-chat')).toBeInTheDocument())

    expect(screen.getByTestId('mock-chat')).toHaveAttribute('data-send-button-loading', 'false')
  })

  it('should use the default send button after the first build message', async () => {
    useChatMock.mockImplementationOnce((
      _config: unknown,
      _formSettings: unknown,
      _chatList: unknown[],
      stopCallback: (taskId: string) => void,
    ) => {
      stopCallbackRef.current = stopCallback

      return {
        chatList: [
          {
            id: 'question-1',
            content: 'Build an agent',
            isAnswer: false,
          },
          {
            id: 'answer-1',
            content: 'Done',
            isAnswer: true,
          },
        ],
        setTargetMessageId: vi.fn(),
        isResponding: false,
        handleSend: handleSendMock,
        suggestedQuestions: [],
        handleStop: () => stopCallback('task-1'),
        handleAnnotationAdded: vi.fn(),
        handleAnnotationEdited: vi.fn(),
        handleAnnotationRemoved: vi.fn(),
      }
    })
    renderPreviewChat({
      sendButtonLabel: 'Start build',
    })

    expect(screen.getByTestId('mock-chat')).toHaveAttribute('data-send-button-label', '')
  })

  it('should sync the completed conversation history into the query cache', async () => {
    const conversationMessagesResponse = {
      data: [
        {
          id: 'message-after-send',
          conversation_id: 'conversation-1',
          query: 'hello',
          answer: 'hi',
          inputs: {},
          message: [],
          message_files: [],
          agent_thoughts: [],
          feedbacks: [],
          answer_tokens: 1,
          message_tokens: 1,
          provider_response_latency: 1,
          status: 'success',
          from_source: 'console',
        },
      ],
    }
    chatMessagesGetMock.mockResolvedValue(conversationMessagesResponse)
    const { queryClient } = renderPreviewChat()

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
    const callbacks = handleSendMock.mock.calls.at(0)?.[2]

    await callbacks.onGetConversationMessages('conversation-1')

    expect(queryClient.getQueryData(consoleQuery.agent.byAgentId.chatMessages.get.queryKey({
      input: {
        params: {
          agent_id: 'agent-1',
        },
        query: {
          conversation_id: 'conversation-1',
        },
      },
    }))).toBe(conversationMessagesResponse)
  })

  it('should notify the owner when a send settles with an error', async () => {
    const onSendInterrupted = vi.fn()
    renderPreviewChat({
      onSendInterrupted,
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
    const callbacks = handleSendMock.mock.calls.at(0)?.[2]

    act(() => {
      callbacks.onSendSettled(true)
    })

    expect(onSendInterrupted).toHaveBeenCalledTimes(1)
  })

  it('should notify the owner when stopping a responding send', async () => {
    const onSendInterrupted = vi.fn()
    renderPreviewChat({
      onSendInterrupted,
    })

    fireEvent.click(screen.getByRole('button', { name: 'stop' }))

    expect(onSendInterrupted).toHaveBeenCalledTimes(1)
    expect(stopPostMock).toHaveBeenCalledWith({
      params: {
        agent_id: 'agent-1',
        task_id: 'task-1',
      },
    })
  })

  it('should notify the owner once when a stopped send later settles with an error', async () => {
    const onSendInterrupted = vi.fn()
    renderPreviewChat({
      onSendInterrupted,
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
    const callbacks = handleSendMock.mock.calls.at(0)?.[2]

    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    act(() => {
      callbacks.onSendSettled(true)
    })

    expect(onSendInterrupted).toHaveBeenCalledTimes(1)
  })

  it('should not send preview chat when draft save fails', async () => {
    const saveDraftBeforeRun = vi.fn().mockRejectedValue(new Error('save failed'))
    renderPreviewChat({
      onSaveDraftBeforeRun: saveDraftBeforeRun,
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(saveDraftBeforeRun).toHaveBeenCalledTimes(1))
    await expect(sendResultRef.current).resolves.toBe(false)
    expect(handleSendMock).not.toHaveBeenCalled()
  })

  it('should send build chat with the debug build draft type', async () => {
    renderPreviewChat({
      draftType: 'debug_build',
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
    expect(handleSendMock).toHaveBeenCalledWith(
      'agent/agent-1/chat-messages',
      expect.objectContaining({
        draft_type: 'debug_build',
      }),
      expect.any(Object),
    )
  })

  it('should send build chat inputs from the prepared build draft snapshot', async () => {
    const saveDraftBeforeRun = vi.fn().mockResolvedValue({
      app_variables: [
        {
          name: 'city',
          type: 'text-input',
          default: 'Paris',
          required: true,
        },
      ],
      model: {
        model_provider: 'openai',
        model: 'gpt-4',
      },
      prompt: {
        system_prompt: 'Build draft prompt',
      },
    })
    renderPreviewChat({
      agentSoulConfig: {
        app_variables: [
          {
            name: 'city',
            type: 'text-input',
            default: 'London',
            required: true,
          },
        ],
      },
      draftType: 'debug_build',
      onSaveDraftBeforeRun: saveDraftBeforeRun,
    })

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
    expect(handleSendMock).toHaveBeenCalledWith(
      'agent/agent-1/chat-messages',
      expect.objectContaining({
        draft_type: 'debug_build',
        inputs: {
          city: 'Paris',
        },
        overrideInputsForm: [
          expect.objectContaining({
            variable: 'city',
            default: 'Paris',
          }),
        ],
      }),
      expect.any(Object),
    )
  })

  it('should keep the current chat session visible when a sent message creates a conversation', async () => {
    chatMessagesGetMock.mockReturnValue(new Promise(() => undefined))
    renderPreviewChatWithConversationHarness()

    fireEvent.click(screen.getByRole('button', { name: 'send' }))

    await waitFor(() => expect(handleSendMock).toHaveBeenCalledTimes(1))
    const callbacks = handleSendMock.mock.calls.at(0)?.[2]

    await act(async () => {
      callbacks.onConversationComplete('conversation-created-by-send')
    })

    expect(screen.getByRole('button', { name: 'send' })).toBeInTheDocument()
    expect(screen.getByText('sessionSent:yes')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('should keep the reset command acknowledgement stable while clear chat is pending', async () => {
    const { renderHarness, rerender } = renderPreviewChatWithClearCommandHarness()

    await waitFor(() => expect(useChatMock).toHaveBeenCalled())
    const firstResetAcknowledgement = useChatMock.mock.calls.at(-1)?.[5]

    rerender(renderHarness('Message agent again'))

    await waitFor(() => expect(useChatMock.mock.calls.length).toBeGreaterThan(1))
    const secondResetAcknowledgement = useChatMock.mock.calls.at(-1)?.[5]

    expect(secondResetAcknowledgement).toBe(firstResetAcknowledgement)
  })

  it('should keep preview file upload disabled by default', async () => {
    renderPreviewChat()

    await waitFor(() => expect(useChatMock).toHaveBeenCalled())

    const config = useChatMock.mock.calls.at(-1)?.[0]
    expect(config.file_upload).toEqual(expect.objectContaining({
      enabled: false,
      allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
    }))
  })

  it('should enable build chat file upload when chat features file upload is enabled', async () => {
    renderPreviewChat({
      agentSoulConfig: {
        app_features: {
          file_upload: {
            enabled: true,
          },
        },
      },
    })

    await waitFor(() => expect(useChatMock).toHaveBeenCalled())

    const config = useChatMock.mock.calls.at(-1)?.[0]
    expect(config.file_upload).toEqual(expect.objectContaining({
      enabled: true,
      allowed_file_types: [SupportUploadFileTypes.image],
      allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      number_limits: 3,
    }))
    expect(config.file_upload.image).toEqual(expect.objectContaining({
      enabled: true,
      transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      number_limits: 3,
    }))
  })
})
