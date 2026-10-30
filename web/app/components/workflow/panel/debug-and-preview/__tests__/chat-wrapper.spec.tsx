import type { ComponentProps } from 'react'
import type { ChatWrapperRefType } from '../index'
import type { HumanInputFieldValue } from '@/app/components/base/chat/chat/answer/human-input-content/field-renderer'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { SpeechToTextTarget } from '@/app/components/base/voice-input/types'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef, useState } from 'react'
import { useNodes } from 'reactflow'
import { createNode, createStartNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import ChatWrapperContent from '../chat-wrapper'
import DebugAndPreview from '../index'
import { useTestConnections } from '../use-test-connections'

const mockUseChat = vi.hoisted(() => vi.fn())

let emitWorkflowEvent: ((event: { type: string }) => void) | undefined
const EmitterProbe = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  emitWorkflowEvent = (event) => eventEmitter?.emit(event as never)
  return null
}

const mockRequest = vi.hoisted(() => vi.fn())
const mockCredentials = vi.hoisted(() => vi.fn())

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: mockCredentials,
}))

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

function ChatWrapper(props: Omit<ComponentProps<typeof ChatWrapperContent>, 'connections'>) {
  const connections = useTestConnections()
  return <ChatWrapperContent {...props} connections={connections} />
}

const createTestTool = (id = 'tool-1', overrides: Record<string, unknown> = {}) =>
  createNode({
    id,
    data: {
      type: BlockEnum.Tool,
      title: `Tool ${id}`,
      provider_id: 'test-provider',
      provider_name: 'Test Provider',
      provider_type: 'builtin',
      tool_name: 'search',
      tool_parameters: {},
      tool_configurations: {},
      credential_source: 'end_user',
      end_user_auth: { allowed_credential_types: ['oauth2'] },
      ...overrides,
    },
  })

function TestGraph() {
  const nodes = useNodes()
  return <output aria-label="Test graph">{JSON.stringify(nodes)}</output>
}

const readTestGraph = () =>
  JSON.parse(screen.getByLabelText('Test graph').textContent!) as ReturnType<typeof createNode>[]

const preflightPath = [
  'apps',
  'byAppId',
  'workflows',
  'draft',
  'testCredentials',
  'preflight',
  'post',
]

const readiness = (ready: boolean, status = 'connected') => ({
  ready,
  credentials: [
    {
      node_id: 'tool-1',
      node_ids: ['tool-1'],
      credential_id: 'oauth-1',
      status,
      check: null,
    },
  ],
})

const mockPreflight = (response: () => unknown) => {
  mockRequest.mockImplementation(async (path: string[]) => {
    if (path.includes('preflight')) return response()
    if (path.includes('clientSchema'))
      return {
        schema: [],
        client_params: {},
        is_system_oauth_params_exists: true,
        is_oauth_custom_client_enabled: false,
        redirect_uri: 'https://example.com/callback',
      }
    return []
  })
}

const setupConnections = ({
  nodes = [createTestTool('tool-1', { test_credential_id: 'oauth-1' })],
  sync = vi.fn(async () => ({ hash: 'draft-hash', updatedAt: 1 })),
  panel = false,
}: {
  nodes?: ReturnType<typeof createNode>[]
  sync?: () => Promise<{ hash: string; updatedAt: number } | null>
  panel?: boolean
} = {}) => {
  const chatRef = createChatWrapperRef()
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  const content = (
    <>
      {panel ? (
        <DebugAndPreview />
      ) : (
        <ChatWrapper
          ref={chatRef}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />
      )}
      <TestGraph />
    </>
  )
  renderWorkflowFlowComponent(content, {
    nodes,
    edges: [],
    hooksStoreProps: { doSyncWorkflowDraft: sync },
    queryClient,
    initialStoreState: { previewPanelWidth: 480, workflowCanvasWidth: 1000 },
  })
  return { sync, chatRef }
}

describe('ChatWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequest.mockReset()
    mockRequest.mockResolvedValue({ data: [] })
    mockCredentials.mockReset()
    mockCredentials.mockResolvedValue({
      credentials: [
        {
          id: 'oauth-1',
          name: 'Personal OAuth',
          provider: 'test-provider',
          credential_type: 'oauth2',
          is_default: true,
        },
        {
          id: 'api-1',
          name: 'Workspace API Key',
          provider: 'test-provider',
          credential_type: 'api-key',
          is_default: false,
        },
      ],
      supported_credential_types: ['oauth2', 'api-key'],
      allow_custom_token: true,
      is_oauth_custom_client_enabled: false,
    })
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
      <EventEmitterContextProvider>
        <EmitterProbe />
        <ChatWrapper
          ref={createChatWrapperRef()}
          showConversationVariableModal={false}
          onConversationModalHide={vi.fn()}
          showInputsFieldsPanel={false}
          onHide={vi.fn()}
        />
      </EventEmitterContextProvider>,
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

    act(() => emitWorkflowEvent?.({ type: EVENT_WORKFLOW_STOP }))

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

  it('keeps the existing empty preview when there are no App user connections', () => {
    setupConnections({ nodes: [createStartNode()], panel: true })
    expect(screen.getByText('workflow.common.previewPlaceholder')).toBeVisible()
    expect(
      screen.queryByRole('region', { name: 'share.connections.configure.title' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /share.connections.configure.title/ }),
    ).not.toBeInTheDocument()
  })

  it('treats an opening statement as not started and displays setup without a header entry', () => {
    mockUseChat.mockReturnValue(
      createChatState({
        chatList: [{ id: 'opening', isAnswer: true, content: 'Welcome', isOpeningStatement: true }],
      }),
    )
    mockPreflight(() => readiness(true))
    setupConnections({ panel: true })
    expect(screen.getByRole('region', { name: 'share.connections.configure.title' })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /share.connections.configure.title/ }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.common.previewPlaceholder')).not.toBeInTheDocument()
  })

  it('moves Connections before Reset after chat starts and restores inline setup after Reset', async () => {
    const user = userEvent.setup()
    let updateChat!: (state: ReturnType<typeof createChatState>) => void
    const handleRestart = vi.fn(() => updateChat(createChatState()))
    const chatState = createChatState({ handleRestart })
    const useChatState = () => {
      const [state, setState] = useState(chatState)
      updateChat = setState
      return state
    }
    mockUseChat.mockImplementation(useChatState)
    mockPreflight(() => readiness(true))
    setupConnections({ panel: true })
    expect(screen.getByRole('region', { name: 'share.connections.configure.title' })).toBeVisible()
    act(() =>
      updateChat(
        createChatState({
          ...chatState,
          chatList: [{ id: 'question-1', isAnswer: false, content: 'Hello' }],
        }),
      ),
    )
    const configure = await screen.findByRole('button', {
      name: 'share.connections.configure.title',
    })
    const reset = screen.getByRole('button', { name: 'common.operation.refresh' })
    const buttons = screen.getAllByRole('button')
    expect(buttons.indexOf(configure)).toBeLessThan(buttons.indexOf(reset))
    expect(
      screen.queryByRole('region', { name: 'share.connections.configure.title' }),
    ).not.toBeInTheDocument()
    await user.click(configure)
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(await within(dialog).findByRole('button', { name: /Personal OAuth/ })).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.close' }))
    await user.click(reset)
    expect(handleRestart).toHaveBeenCalledTimes(1)
    expect(
      await screen.findByRole('region', { name: 'share.connections.configure.title' }),
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /share.connections.configure.title/ }),
    ).not.toBeInTheDocument()
  })

  it('configures independent App user roots without merging providers or listing reused and workspace nodes', async () => {
    const user = userEvent.setup()
    mockPreflight(() => ({ ready: false, credentials: [] }))
    const sync = vi.fn(async () => {
      expect(readTestGraph().find((node) => node.id === 'tool-1')).toBeDefined()
      return { hash: 'draft-hash', updatedAt: 1 }
    })
    setupConnections({
      nodes: [
        createTestTool(),
        createTestTool('tool-2', { end_user_auth: { allowed_credential_types: ['api-key'] } }),
        createTestTool('reuse', { credential_source: 'reuse_node', reuse_node_id: 'tool-1' }),
        createTestTool('workspace', { credential_source: 'workspace' }),
      ],
      sync,
    })

    const setup = await screen.findByRole('region', { name: 'share.connections.configure.title' })
    const rows = within(setup).getAllByRole('listitem', { name: 'Test Provider' })
    expect(rows).toHaveLength(2)
    expect(within(setup).queryByText('Tool reuse')).not.toBeInTheDocument()
    expect(within(setup).queryByText('Tool workspace')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.common.previewPlaceholder')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /share.connections.configure.title/ }),
    ).not.toBeInTheDocument()
    expect(within(rows[0]!).queryByRole('status')).not.toBeInTheDocument()

    const firstPicker = await within(rows[0]!).findByRole('button', {
      name: /plugin.auth.appUser.testConnection/,
    })
    await waitFor(() => expect(firstPicker).toBeEnabled())
    await user.click(firstPicker)
    const picker = await screen.findByRole('dialog', { name: 'plugin.auth.authorization' })
    expect(within(picker).queryByText('Workspace API Key')).not.toBeInTheDocument()
    expect(within(picker).queryByText('plugin.auth.workspaceDefault')).not.toBeInTheDocument()
    await user.click(within(picker).getByRole('button', { name: /^Personal OAuth/ }))
    await waitFor(() => {
      expect(readTestGraph().find((node) => node.id === 'tool-1')?.data).toMatchObject({
        test_credential_id: 'oauth-1',
        credential_source: 'end_user',
      })
      expect(sync).toHaveBeenCalled()
    })
    expect(readTestGraph().find((node) => node.id === 'tool-2')?.data).not.toHaveProperty(
      'test_credential_id',
    )
    expect(mockRequest).toHaveBeenCalledWith(
      preflightPath,
      { params: { app_id: 'app-1' } },
      expect.any(Object),
    )
  })

  it('waits for draft synchronization and a ready preflight before sending without a connection payload', async () => {
    const user = userEvent.setup()
    const handleSend = vi.fn()
    mockUseChat.mockReturnValue(createChatState({ handleSend }))
    let finishSync!: (value: { hash: string; updatedAt: number }) => void
    let finishPreflight!: (value: ReturnType<typeof readiness>) => void
    const sync = vi.fn(
      () =>
        new Promise<{ hash: string; updatedAt: number }>((resolve) => {
          finishSync = resolve
        }),
    )
    mockPreflight(
      () =>
        new Promise<ReturnType<typeof readiness>>((resolve) => {
          finishPreflight = resolve
        }),
    )
    setupConnections({ sync })
    await user.click(screen.getByRole('button', { name: 'send-chat' }))
    expect(sync).toHaveBeenCalledTimes(1)
    expect(
      mockRequest.mock.calls.filter(([path]) => (path as string[]).includes('preflight')),
    ).toHaveLength(0)
    expect(handleSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'send-chat' })).toBeDisabled()
    await act(async () => finishSync({ hash: 'draft-hash', updatedAt: 1 }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        preflightPath,
        { params: { app_id: 'app-1' } },
        expect.any(Object),
      ),
    )
    expect(handleSend).not.toHaveBeenCalled()
    await act(async () => finishPreflight(readiness(true)))
    await waitFor(() =>
      expect(handleSend).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ query: 'hello', conversation_id: 'conversation-1' }),
        expect.any(Object),
      ),
    )
    expect(handleSend.mock.calls[0]![0]).not.toHaveProperty('connections')
  })

  it('does not preflight or send when saving the draft fails, and allows retrying', async () => {
    const user = userEvent.setup()
    const handleSend = vi.fn()
    mockUseChat.mockReturnValue(createChatState({ handleSend }))
    mockPreflight(() => readiness(true))
    const sync = vi
      .fn<() => Promise<{ hash: string; updatedAt: number } | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ hash: 'draft-hash', updatedAt: 1 })
    setupConnections({ sync })
    await user.click(screen.getByRole('button', { name: 'send-chat' }))
    const setup = screen.getByRole('region', { name: 'share.connections.configure.title' })
    expect(await within(setup).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    expect(
      screen.queryByRole('dialog', { name: 'share.connections.configure.title' }),
    ).not.toBeInTheDocument()
    expect(
      mockRequest.mock.calls.filter(([path]) => (path as string[]).includes('preflight')),
    ).toHaveLength(0)
    expect(handleSend).not.toHaveBeenCalled()
    await user.click(within(setup).getByRole('button', { name: 'common.operation.retry' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        preflightPath,
        { params: { app_id: 'app-1' } },
        expect.any(Object),
      ),
    )
    await waitFor(() => expect(within(setup).queryByRole('alert')).not.toBeInTheDocument())
    expect(handleSend).not.toHaveBeenCalled()
  })

  it('does not send an old message or reopen settings when restarted during preflight', async () => {
    const user = userEvent.setup()
    const chatState = createChatState()
    mockUseChat.mockReturnValue(chatState)
    let finishPreflight!: (value: ReturnType<typeof readiness>) => void
    mockPreflight(
      () =>
        new Promise<ReturnType<typeof readiness>>((resolve) => {
          finishPreflight = resolve
        }),
    )
    const { chatRef } = setupConnections()
    await user.click(screen.getByRole('button', { name: 'send-chat' }))
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(
        preflightPath,
        { params: { app_id: 'app-1' } },
        expect.any(Object),
      ),
    )
    act(() => chatRef.current?.handleRestart())
    expect(chatState.handleRestart).toHaveBeenCalledTimes(1)
    await act(async () => finishPreflight(readiness(true)))
    await waitFor(() => expect(screen.getByRole('button', { name: 'send-chat' })).toBeEnabled())
    expect(chatState.handleSend).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('dialog', { name: 'share.connections.configure.title' }),
    ).not.toBeInTheDocument()
  })

  it.each(['invalid', 'request-error'])(
    'keeps the first chat unsent and reports %s preflight in the inline setup',
    async (failure) => {
      const user = userEvent.setup()
      const handleSend = vi.fn()
      mockUseChat.mockReturnValue(createChatState({ handleSend }))
      mockPreflight(() => {
        if (failure === 'request-error') throw new Error('Preflight unavailable')
        return readiness(false, 'invalid')
      })
      setupConnections()
      await user.click(screen.getByRole('button', { name: 'send-chat' }))
      const setup = screen.getByRole('region', { name: 'share.connections.configure.title' })
      expect(handleSend).not.toHaveBeenCalled()
      expect(
        screen.queryByRole('dialog', { name: 'share.connections.configure.title' }),
      ).not.toBeInTheDocument()
      if (failure === 'invalid')
        expect(
          await within(within(setup).getByRole('listitem', { name: 'Test Provider' })).findByRole(
            'status',
          ),
        ).toHaveTextContent('plugin.auth.unavailable')
      else
        expect(await within(setup).findByRole('alert')).toHaveTextContent('common.api.actionFailed')
    },
  )

  it('keeps configuration selection disabled during an active response', async () => {
    const user = userEvent.setup()
    mockUseChat.mockReturnValue(createChatState({ isResponding: true }))
    mockPreflight(() => readiness(true))
    setupConnections({ panel: true })
    await user.click(screen.getByRole('button', { name: 'share.connections.configure.title' }))
    const dialog = await screen.findByRole('dialog', { name: 'share.connections.configure.title' })
    expect(await within(dialog).findByRole('button', { name: /Personal OAuth/ })).toBeDisabled()
  })
})
