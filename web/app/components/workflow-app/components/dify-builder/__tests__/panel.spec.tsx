import type { ConversationItem, SessionModel, SessionView } from '../types'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import DifyBuilderPanel from '../panel'
import {
  difyBuilderConversationAtom,
  difyBuilderRetryableMessageAtom,
  difyBuilderSessionErrorCodeAtom,
  difyBuilderSessionLastErrorAtom,
  difyBuilderSessionViewAtom,
} from '../session/state'
import {
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDraftAtom,
  difyBuilderLocalErrorAtom,
  difyBuilderRuntimeAtom,
} from '../store'

const mocks = vi.hoisted(() => ({
  closePanel: vi.fn(),
  model: {
    completion_params: {},
    mode: 'chat',
    name: 'gpt-4o',
    provider: 'openai',
  } as SessionModel | null,
  reset: vi.fn(),
  runAction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => true),
  startBuild: vi.fn(async () => true),
}))

const sessionView: SessionView = {
  actions: [],
  app_revision: { current: 'hash-1', conflicted: false },
  canvas_read_only: false,
  active_interaction: null,
  conversation_last_seq: 1,
  interrupted: false,
  phase: 'plan',
  run_status: 'waiting_input',
  session_id: 'session-1',
  version: 1,
}

const choiceView: SessionView = {
  ...sessionView,
  actions: [{ id: 'approve_plan', label: 'Approve plan', kind: 'primary' }],
  decision: {
    title: 'Is this workflow plan ready to apply?',
    description: 'Choose one option to continue.',
    default_option_id: 'approve_plan',
    options: [{ id: 'approve_plan', label: 'Approve plan', is_default: true }],
    submit: { id: 'confirm', label: 'Submit', kind: 'primary' },
  },
}

const sessionConversation: ConversationItem[] = [
  {
    seq: 0,
    at_version: 1,
    kind: 'user',
    payload: { text: 'Fix the workflow', turn_id: 'turn-user-1' },
  },
  {
    seq: 1,
    at_version: 1,
    kind: 'assistant_turn',
    payload: {
      turn_id: 'turn-1',
      stage_id: 'fix.plan',
      execution: { status: 'completed' },
      reply_text: 'I found the failing configuration.',
    },
  },
]

vi.mock('../model-selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))

vi.mock('../use-dify-builder-model', () => ({
  useDifyBuilderModel: () => ({
    model: mocks.model,
    selection: mocks.model,
    modelList: [],
    isLoading: false,
    isError: false,
    hasAvailableModels: true,
    retry: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { setShowDifyBuilderPanel: typeof mocks.closePanel }) => T) =>
    selector({ setShowDifyBuilderPanel: mocks.closePanel }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: <T,>(selector: (state: { configsMap?: undefined }) => T) =>
    selector({ configsMap: undefined }),
}))

const renderPanel = (
  view: SessionView = sessionView,
  initializeStore?: (store: ReturnType<typeof createStore>) => void,
  conversation: ConversationItem[] = sessionConversation,
) => {
  const store = createStore()
  const queryClient = createConsoleQueryClient()
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderSessionViewAtom, view)
  store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: view.session_id, version: view.version })
  store.set(difyBuilderConversationAtom, conversation)
  store.set(difyBuilderRuntimeAtom, {
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    session: {
      onCanvasRefreshed: vi.fn(),
      refresh: vi.fn(async () => true),
      getTrace: vi.fn(() => ({ entries: [], truncated: false })),
      loadOlderConversation: vi.fn(async () => true),
      restore: vi.fn(async () => true),
      reset: mocks.reset,
      runAction: mocks.runAction,
      sendMessage: mocks.sendMessage,
      startBuild: mocks.startBuild,
      startChecklistFix: vi.fn(async () => true),
      startEdit: vi.fn(async () => true),
      startFix: vi.fn(async () => true),
      updateModel: vi.fn(async () => true),
    },
    setShowPanel: mocks.closePanel,
  })
  initializeStore?.(store)
  const { wrapper: NuqsWrapper } = createNuqsTestWrapper()
  const result = renderWithConsoleQuery(
    <Provider store={store}>
      <NuqsWrapper>
        <DifyBuilderPanel />
      </NuqsWrapper>
    </Provider>,
    { queryClient },
  )
  return { ...result, store }
}

describe('DifyBuilderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.model = {
      completion_params: {},
      mode: 'chat',
      name: 'gpt-4o',
      provider: 'openai',
    }
  })

  it('opens accessible help without changing the conversation or composer draft', async () => {
    const user = userEvent.setup()
    renderPanel(sessionView, (store) => {
      store.set(difyBuilderDraftAtom, 'Pending request')
    })
    const help = screen.getByRole('button', { name: 'workflow.difyBuilder.helpTitle' })

    await user.click(help)

    const explanation = await screen.findByRole('dialog', {
      name: 'workflow.difyBuilder.helpTitle',
    })
    expect(explanation).toHaveAccessibleDescription('workflow.difyBuilder.helpDescription')
    expect(explanation).toHaveTextContent('workflow.difyBuilder.helpDescription')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(help).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(
      await screen.findByRole('dialog', { name: 'workflow.difyBuilder.helpTitle' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Fix the workflow')).toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' }),
    ).toHaveValue('Pending request')
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('keeps the debug log export available from the header menu', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))

    expect(
      await screen.findByRole('menuitem', { name: 'workflow.difyBuilder.exportDebugLog' }),
    ).toBeEnabled()
  })

  it('closes the panel without resetting the session or losing the draft', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel(sessionView, (store) => {
      store.set(difyBuilderDraftAtom, 'Pending request')
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(mocks.closePanel).toHaveBeenCalledWith(false)
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(store.get(difyBuilderSessionViewAtom)).toEqual(sessionView)
    expect(store.get(difyBuilderDraftAtom)).toBe('Pending request')
  })

  it.each(['empty', 'processing'])('disables reset for an %s session', async (state) => {
    const user = userEvent.setup()
    renderPanel(sessionView, (store) => {
      store.set(
        difyBuilderSessionViewAtom,
        state === 'empty' ? null : { ...sessionView, run_status: 'processing' },
      )
    })
    const reset = screen.getByRole('button', { name: 'workflow.difyBuilder.reset' })

    expect(reset).toBeDisabled()
    await user.click(reset)
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeEnabled()
  })

  it('keeps the blocking interaction below the conversation and replaces the composer', () => {
    renderPanel(choiceView)

    const option = screen.getByRole('radio', { name: 'Approve plan' })
    const submit = screen.getByRole('button', { name: 'common.operation.submit' })
    const dock = screen.getByRole('region', { name: 'Is this workflow plan ready to apply?' })
    const message = screen.getByText('Fix the workflow')
    expect(message.compareDocumentPosition(option) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(option).toBeChecked()
    expect(submit).toHaveAttribute('type', 'submit')
    expect(submit).toHaveAttribute('form', option.closest('form')?.id)
    expect(
      within(dock).queryByRole('button', { name: /cancel|close|skip/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Model selector' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /attach/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /voice|microphone/i })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflow.difyBuilder.messageSend' }),
    ).not.toBeInTheDocument()
  })

  it('clears the composer immediately when Enter submits a pending message', async () => {
    const user = userEvent.setup()
    let finishSending!: (sent: boolean) => void
    const sending = new Promise<boolean>((resolve) => {
      finishSending = resolve
    })
    mocks.sendMessage.mockReturnValueOnce(sending)
    renderPanel()

    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    await user.type(composer, 'Make the repair smaller')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mocks.sendMessage).toHaveBeenCalledWith('Make the repair smaller')
    })
    try {
      expect(composer).toHaveValue('')
    } finally {
      await act(async () => {
        finishSending(true)
        await sending
      })
    }
  })

  it('keeps the draft editable and blocks submission when no model is available', async () => {
    const user = userEvent.setup()
    mocks.model = null
    renderPanel(sessionView, (store) => {
      store.set(difyBuilderDraftAtom, 'Do not submit this draft')
    })

    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    const sendButton = screen.getByRole('button', {
      name: 'workflow.difyBuilder.messageSend',
    })
    const form = composer.closest('form')

    expect(composer).toBeEnabled()
    expect(composer).toHaveAccessibleDescription(
      'workflowGenerator.workflowGenerator.modelRequired',
    )
    expect(sendButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Model selector' })).toBeEnabled()
    expect(form).not.toBeNull()

    fireEvent.submit(form!)

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(mocks.startBuild).not.toHaveBeenCalled()
    expect(composer).toHaveValue('Do not submit this draft')
    await user.type(composer, ' yet')
    expect(composer).toHaveValue('Do not submit this draft yet')
  })

  it('shows model recovery guidance and still reports a later draft synchronization error', () => {
    const { store } = renderPanel(sessionView, (store) => {
      store.set(difyBuilderSessionErrorCodeAtom, 'model_unavailable')
      store.set(
        difyBuilderSessionLastErrorAtom,
        'HTTP 400: model_unavailable: Builder model is unavailable',
      )
    })
    expect(screen.getByRole('alert')).toHaveTextContent('workflow.difyBuilder.modelUnavailable')
    expect(screen.queryByText(/HTTP 400/)).not.toBeInTheDocument()

    act(() => store.set(difyBuilderLocalErrorAtom, 'Workflow draft sync failed.'))

    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByText('Workflow draft sync failed.')).toBeInTheDocument()
  })

  it('renders failed user messages without message actions', () => {
    renderPanel(sessionView, (store) => {
      store.set(difyBuilderRetryableMessageAtom, {
        sessionId: 'session-1',
        text: 'Fix the workflow',
        turnId: 'turn-user-1',
      })
    })

    const log = screen.getByRole('log', { name: 'workflow.difyBuilder.panelTitle' })
    expect(within(log).getByText('Fix the workflow')).toBeInTheDocument()
    expect(within(log).queryAllByRole('button')).toHaveLength(0)
  })

  it('does not submit while Enter confirms an IME composition', async () => {
    renderPanel()
    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })

    fireEvent.change(composer, { target: { value: '你好' } })
    fireEvent.compositionStart(composer)
    await act(async () => {
      fireEvent.keyDown(composer, { isComposing: true, key: 'Enter' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.sendMessage).not.toHaveBeenCalled()
    expect(composer).toHaveValue('你好')
  })

  it('keeps Enter blocked briefly after an IME composition ends', async () => {
    vi.useFakeTimers()
    try {
      renderPanel()
      const composer = screen.getByRole('textbox', {
        name: 'workflow.difyBuilder.messagePlaceholder',
      })

      fireEvent.change(composer, { target: { value: '你好' } })
      fireEvent.compositionStart(composer)
      fireEvent.compositionEnd(composer)
      await act(async () => {
        fireEvent.keyDown(composer, { isComposing: false, key: 'Enter' })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mocks.sendMessage).not.toHaveBeenCalled()
      expect(composer).toHaveValue('你好')

      act(() => {
        vi.advanceTimersByTime(50)
      })
      vi.useRealTimers()
      fireEvent.keyDown(composer, { isComposing: false, key: 'Enter' })

      await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledWith('你好'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('allows a terminal session to start a new flow from the composer', async () => {
    const user = userEvent.setup()
    renderPanel({
      ...sessionView,
      actions: [],
      phase: 'complete',
      run_status: 'complete',
    })

    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    await user.type(composer, 'Build a smaller workflow')
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

    expect(mocks.startBuild).toHaveBeenCalledWith('app-1', 'Build a smaller workflow', mocks.model)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('submits a selected action through the single Submit button', async () => {
    const user = userEvent.setup()
    renderPanel(choiceView)

    await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))

    expect(mocks.runAction).toHaveBeenCalledWith('confirm', { option_id: 'approve_plan' })
  })

  it('shows a selected action in the conversation before the command finishes', async () => {
    const user = userEvent.setup()
    let finishAction!: (submitted: boolean) => void
    const action = new Promise<boolean>((resolve) => {
      finishAction = resolve
    })
    mocks.runAction.mockReturnValueOnce(action)
    renderPanel(choiceView)

    await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))

    const log = screen.getByRole('log', { name: 'workflow.difyBuilder.panelTitle' })
    expect(
      await within(log).findByRole('heading', {
        name: 'Is this workflow plan ready to apply?',
      }),
    ).toBeInTheDocument()
    expect(within(log).getByText('Approve plan')).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Is this workflow plan ready to apply?' }),
    ).not.toBeInTheDocument()

    await act(async () => {
      finishAction(true)
      await action
    })
  })

  it('submits free text only for the option that requests it', async () => {
    const user = userEvent.setup()
    renderPanel({
      ...choiceView,
      actions: [
        { id: 'approve_plan', label: 'Approve fix', kind: 'primary' },
        { id: 'reject_repair', label: 'Reject', kind: 'destructive' },
      ],
      decision: {
        title: 'How should Builder proceed with this fix?',
        description: 'Choose one option to continue.',
        default_option_id: 'approve_plan',
        submit: { id: 'confirm', label: 'Submit', kind: 'primary' },
        options: [
          { id: 'approve_plan', label: 'Approve fix', is_default: true },
          {
            id: 'reject_repair',
            label: 'Reject',
            input: {
              placeholder: 'Explain the rejection',
              min_length: 10,
              max_length: 200,
              required: true,
            },
          },
        ],
      },
    })

    await user.click(screen.getByRole('radio', { name: 'Reject' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Explain the rejection' }),
      'Too risky to apply',
    )
    await user.click(screen.getByRole('radio', { name: 'Approve fix' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))

    expect(mocks.runAction).toHaveBeenCalledWith('confirm', { option_id: 'approve_plan' })
  })

  it('wraps provided test inputs in the backend testdata payload', async () => {
    const user = userEvent.setup()
    const card: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'testdata',
        fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
        values: {},
      },
    }
    renderPanel(
      {
        ...sessionView,
        actions: [{ id: 'provide_testdata', label: 'Provide test data', kind: 'primary' }],
        active_interaction: {
          action_id: 'provide_testdata',
          card_seq: card.seq,
          valid_at_version: 1,
        },
        conversation_last_seq: 0,
        phase: 'test',
      },
      undefined,
      [card],
    )

    const input = screen.getByRole('textbox', { name: 'Topic' })
    const action = screen.getByRole('button', { name: 'workflow.difyBuilder.runTest' })
    const form = input.closest('form')
    expect(form).not.toBeNull()
    expect(action).toHaveAttribute('type', 'submit')
    expect(action).toHaveAttribute('form', form?.id)

    await user.type(input, 'AI agents')
    await user.click(action)

    expect(mocks.runAction).toHaveBeenCalledWith('provide_testdata', {
      mode: 'provide',
      inputs: { topic: 'AI agents' },
    })
  })

  it('hides untouched required field errors until a submit attempt', async () => {
    const user = userEvent.setup()
    const card: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'testdata',
        fields: [
          { key: 'input_text', label: 'Input Text', type: 'text-input', required: true },
          { key: 'model_name', label: 'Model Name', type: 'text-input', required: true },
        ],
        values: {},
      },
    }
    renderPanel(
      {
        ...sessionView,
        actions: [{ id: 'provide_testdata', label: 'Provide test data', kind: 'primary' }],
        active_interaction: {
          action_id: 'provide_testdata',
          card_seq: card.seq,
          valid_at_version: 1,
        },
        conversation_last_seq: 0,
        phase: 'test',
      },
      undefined,
      [card],
    )

    const inputText = screen.getByRole('textbox', { name: 'Input Text' })
    const modelName = screen.getByRole('textbox', { name: 'Model Name' })
    const submit = screen.getByRole('button', { name: 'workflow.difyBuilder.runTest' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(inputText).not.toHaveAttribute('aria-invalid')
    expect(modelName).not.toHaveAttribute('aria-invalid')

    await user.click(submit)

    expect(mocks.runAction).not.toHaveBeenCalled()
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(inputText).toHaveFocus()
    expect(inputText).toHaveAttribute('aria-invalid', 'true')
    expect(modelName).toHaveAttribute('aria-invalid', 'true')

    await user.type(inputText, 'Hello')
    await user.type(modelName, 'GPT')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(submit)
    expect(mocks.runAction).toHaveBeenCalledWith('provide_testdata', {
      mode: 'provide',
      inputs: { input_text: 'Hello', model_name: 'GPT' },
    })
  })

  it('restores a submitted form with its draft when the action is rejected', async () => {
    const user = userEvent.setup()
    let finishAction!: (submitted: boolean) => void
    const action = new Promise<boolean>((resolve) => {
      finishAction = resolve
    })
    mocks.runAction.mockReturnValueOnce(action)
    const card: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'testdata',
        title: 'Provide test data',
        fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
        values: {},
      },
    }
    renderPanel(
      {
        ...sessionView,
        actions: [{ id: 'provide_testdata', label: 'Provide test data', kind: 'primary' }],
        active_interaction: {
          action_id: 'provide_testdata',
          card_seq: card.seq,
          valid_at_version: 1,
        },
        conversation_last_seq: 0,
        phase: 'test',
      },
      undefined,
      [card],
    )

    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'AI agents')
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.runTest' }))

    const log = screen.getByRole('log', { name: 'workflow.difyBuilder.panelTitle' })
    expect(
      await within(log).findByRole('heading', { name: 'Provide test data' }),
    ).toBeInTheDocument()
    expect(within(log).getByText('AI agents')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Topic' })).not.toBeInTheDocument()

    await act(async () => {
      finishAction(false)
      await action
    })

    expect(await screen.findByRole('textbox', { name: 'Topic' })).toHaveValue('AI agents')
    expect(
      within(log).queryByRole('heading', { name: 'Provide test data' }),
    ).not.toBeInTheDocument()
  })

  it('preserves an active form draft when the session version advances', async () => {
    const user = userEvent.setup()
    const card: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'testdata',
        fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
        values: {},
      },
    }
    const view: SessionView = {
      ...sessionView,
      actions: [{ id: 'provide_testdata', label: 'Provide test data', kind: 'primary' }],
      active_interaction: {
        action_id: 'provide_testdata',
        card_seq: card.seq,
        valid_at_version: 1,
      },
      conversation_last_seq: 0,
      phase: 'test',
    }
    const { store } = renderPanel(view, undefined, [card])

    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'AI agents')
    act(() => {
      store.set(difyBuilderSessionViewAtom, {
        ...view,
        version: 2,
        active_interaction: {
          action_id: 'provide_testdata',
          card_seq: card.seq,
          valid_at_version: 2,
        },
      })
    })

    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('AI agents')
    expect(screen.getByRole('button', { name: 'workflow.difyBuilder.runTest' })).toBeDisabled()
    act(() =>
      store.set(difyBuilderCanvasAppliedViewAtom, { sessionId: view.session_id, version: 2 }),
    )
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.runTest' }))
    expect(mocks.runAction).toHaveBeenCalledWith('provide_testdata', {
      mode: 'provide',
      inputs: { topic: 'AI agents' },
    })
  })

  it('blocks malformed JSON test data and submits the parsed value after correction', async () => {
    const user = userEvent.setup()
    const card: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'testdata',
        fields: [{ key: 'profile', label: 'Profile', type: 'json_object' }],
        values: {},
      },
    }
    renderPanel(
      {
        ...sessionView,
        actions: [{ id: 'provide_testdata', label: 'Provide test data', kind: 'primary' }],
        active_interaction: {
          action_id: 'provide_testdata',
          card_seq: card.seq,
          valid_at_version: 1,
        },
        conversation_last_seq: 0,
        phase: 'test',
      },
      undefined,
      [card],
    )
    const input = screen.getByRole('textbox', { name: 'Profile' })
    const action = screen.getByRole('button', { name: 'workflow.difyBuilder.runTest' })

    await user.click(input)
    await user.paste('{"name":')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(action).toBeEnabled()
    await user.click(action)
    expect(mocks.runAction).not.toHaveBeenCalled()
    expect(input).toHaveFocus()

    await user.clear(input)
    await user.paste('{"name":"Ada"}')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    await user.click(action)

    expect(mocks.runAction).toHaveBeenCalledWith('provide_testdata', {
      mode: 'provide',
      inputs: { profile: { name: 'Ada' } },
    })
  })

  it('preserves numeric defaults in form cards', () => {
    const card: Extract<ConversationItem, { kind: 'form' }> = {
      seq: 0,
      at_version: 1,
      kind: 'form',
      payload: {
        variant: 'build_requirements',
        fields: [{ key: 'retries', label: 'Retries', type: 'number' }],
        values: { retries: 3 },
      },
    }
    renderPanel(
      {
        ...sessionView,
        active_interaction: {
          action_id: 'submit_requirements',
          card_seq: card.seq,
          valid_at_version: 1,
        },
        conversation_last_seq: 0,
      },
      undefined,
      [card],
    )

    expect(screen.getByRole('spinbutton', { name: 'Retries' })).toHaveValue(3)
  })

  it('blocks recheck until the refreshed checklist generation is registered', () => {
    renderPanel({
      ...sessionView,
      actions: [{ id: 'recheck', label: 'Re-check', kind: 'primary' }],
      decision: {
        title: 'What should Builder do next?',
        default_option_id: 'recheck',
        options: [{ id: 'recheck', label: 'Re-check', is_default: true }],
        submit: { id: 'confirm', label: 'Submit', kind: 'primary' },
      },
    })

    expect(screen.getByRole('radio', { name: 'Re-check' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'common.operation.submit' })).toBeDisabled()
  })

  it('allows an interrupted execution to be reset while keeping the composer disabled', async () => {
    const user = userEvent.setup()
    renderPanel({
      ...sessionView,
      actions: [],
      canvas_read_only: true,
      interrupted: true,
      run_status: 'processing',
    })

    expect(
      screen.getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' }),
    ).toBeDisabled()
    const reset = screen.getByRole('button', { name: 'workflow.difyBuilder.reset' })
    expect(reset).toBeEnabled()

    await user.click(reset)

    expect(mocks.reset).toHaveBeenCalledOnce()
  })

  it('shows durable recovery guidance and keeps a paused composer disabled', () => {
    renderPanel({
      ...sessionView,
      actions: [],
      recovery: {
        can_continue: false,
        can_restart: true,
        message: 'The draft changed while Builder was paused.',
        recovery_class: 'structure_changed',
      },
      run_status: 'paused',
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The draft changed while Builder was paused.',
    )
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' }),
    ).toBeDisabled()
  })

  it('offers an accessible retry action after canvas refresh failure', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel(choiceView, (store) => {
      store.set(difyBuilderCanvasRefreshFailedAtom, true)
    })

    const retry = screen.getByRole('button', { name: 'common.operation.retry' })
    expect(retry).toBeEnabled()
    expect(screen.getByRole('button', { name: 'common.operation.submit' })).toBeDisabled()
    expect(
      screen.queryByRole('textbox', { name: 'workflow.difyBuilder.messagePlaceholder' }),
    ).not.toBeInTheDocument()

    await user.click(retry)

    expect(store.get(difyBuilderCanvasRefreshingAtom)).toBe(true)
    expect(retry).toHaveAttribute('aria-disabled', 'true')
  })
})
