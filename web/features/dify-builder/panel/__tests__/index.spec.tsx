import type { ConversationItem, SessionModel, SessionView } from '../../types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import DifyBuilderPanel from '..'
import {
  difyBuilderConversationAtom,
  difyBuilderConversationHasMoreAtom,
  difyBuilderSessionBusyAtom,
  difyBuilderSessionViewAtom,
} from '../../session/state'
import {
  difyBuilderCanvasAppliedViewAtom,
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderDraftAtom,
  difyBuilderRuntimeAtom,
} from '../../state'

const mocks = vi.hoisted(() => ({
  closePanel: vi.fn(),
  model: {
    completion_params: {},
    mode: 'chat',
    name: 'gpt-4o',
    provider: 'openai',
  } as SessionModel | null,
  reset: vi.fn(),
  clearConversation: vi.fn(async () => true),
  abandonTask: vi.fn(async () => true),
  runAction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => true),
  startBuild: vi.fn(async () => true),
  stopTask: vi.fn(async () => true),
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
  reply_language: '',
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

// Legacy persisted content can violate the generated text contract at runtime.
const malformedConversation = [
  {
    seq: 0,
    at_version: 1,
    kind: 'user',
    payload: { text: { privateConfiguration: 'Do not expose this' }, turn_id: 'turn-user-1' },
  },
] as unknown as ConversationItem[]

// Markdown has its own rendering tests; panel recovery must not depend on its dynamic import.
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: MarkdownProps) => <div>{content}</div>,
}))

vi.mock('../../model/selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))

vi.mock('../../model/use-model', () => ({
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
  const retryCanvasRefresh = vi.fn(() => store.set(difyBuilderCanvasRefreshingAtom, true))
  const queryClient = createConsoleQueryClient()
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderSessionViewAtom, view)
  store.set(difyBuilderCanvasAppliedViewAtom, {
    sessionId: view.session_id,
    version: view.version,
  })
  store.set(difyBuilderConversationAtom, conversation)
  store.set(difyBuilderRuntimeAtom, {
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edges: [], isChatflow: false }),
    retryCanvasRefresh,
    session: {
      onCanvasRefreshed: vi.fn(),
      refresh: vi.fn(async () => true),
      getTrace: vi.fn(() => ({ entries: [], truncated: false })),
      loadOlderConversation: vi.fn(async () => true),
      restore: vi.fn(async () => true),
      stopTask: mocks.stopTask,
      resumeTask: vi.fn(async () => true),
      reset: mocks.reset,
      clearConversation: mocks.clearConversation,
      abandonTask: mocks.abandonTask,
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
  return { ...result, store, retryCanvasRefresh }
}

describe('DifyBuilderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clearConversation.mockResolvedValue(true)
    mocks.model = {
      completion_params: {},
      mode: 'chat',
      name: 'gpt-4o',
      provider: 'openai',
    }
  })

  it('waits for the opening command before showing a first-version interruption', () => {
    const interruptedView: SessionView = {
      ...sessionView,
      interrupted: true,
      phase: 'understand',
      run_status: 'processing',
      actions: [{ id: 'recovery_continue', label: 'Retry', kind: 'primary' }],
      decision: {
        title: 'How should Builder continue?',
        default_option_id: 'recovery_continue',
        options: [{ id: 'recovery_continue', label: 'Retry', is_default: true }],
        submit: { id: 'confirm', label: 'Retry', kind: 'primary' },
      },
    }
    const { store } = renderPanel(interruptedView, (store) =>
      store.set(difyBuilderSessionBusyAtom, true),
    )

    expect(screen.queryByText('difyBuilder.interrupted')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

    act(() => store.set(difyBuilderSessionBusyAtom, false))
    expect(screen.getByText('difyBuilder.interrupted')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })

  it('contains malformed conversation content while preserving controls and retries the same session', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { store } = renderPanel(
        sessionView,
        (store) => {
          store.set(difyBuilderDraftAtom, 'Pending request')
          store.set(difyBuilderConversationHasMoreAtom, true)
        },
        malformedConversation,
      )

      expect(screen.getByRole('button', { name: 'difyBuilder.reset' })).toBeEnabled()
      expect(screen.getAllByRole('button', { name: 'common.operation.more' })).toHaveLength(2)
      expect(screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })).toHaveValue(
        'Pending request',
      )
      expect(screen.queryByText(/Do not expose this/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
      expect(mocks.closePanel).toHaveBeenCalledWith(false)
      expect(store.get(difyBuilderSessionViewAtom)).toEqual(sessionView)
      expect(store.get(difyBuilderConversationAtom)).toEqual(malformedConversation)

      act(() => store.set(difyBuilderConversationAtom, sessionConversation))
      await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))

      expect(screen.getByText('Fix the workflow')).toBeInTheDocument()
      expect(await screen.findByText('I found the failing configuration.')).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })).toHaveValue(
        'Pending request',
      )
      expect(store.get(difyBuilderSessionViewAtom)).toEqual(sessionView)
      expect(store.get(difyBuilderConversationAtom)).toEqual(sessionConversation)
      expect(mocks.reset).not.toHaveBeenCalled()
      expect(mocks.sendMessage).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('confirms clearing the conversation before resetting the local history', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: 'difyBuilder.reset' }))
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(mocks.clearConversation).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'difyBuilder.reset' }))
    expect(mocks.clearConversation).toHaveBeenCalledOnce()
    expect(mocks.reset).toHaveBeenCalledOnce()
  })

  it('keeps history and the unsent draft when the confirmed server clear fails', async () => {
    mocks.clearConversation.mockResolvedValue(false)
    const user = userEvent.setup()
    const { store } = renderPanel()
    act(() => store.set(difyBuilderDraftAtom, 'Keep my draft'))
    await user.click(screen.getByRole('button', { name: 'difyBuilder.reset' }))
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'difyBuilder.reset',
      }),
    )
    expect(mocks.clearConversation).toHaveBeenCalledOnce()
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(screen.getByText('I found the failing configuration.')).toBeInTheDocument()
    expect(store.get(difyBuilderDraftAtom)).toBe('Keep my draft')
  })

  it('exits an active task through confirmation while keeping the conversation and draft', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel({ ...sessionView, task_id: 'task-1', task_status: 'active' })
    act(() => store.set(difyBuilderDraftAtom, 'Next requirement'))
    expect(screen.getByRole('button', { name: 'difyBuilder.reset' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'difyBuilder.taskControl.abandon' }))
    expect(mocks.abandonTask).not.toHaveBeenCalled()
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'common.operation.confirm',
      }),
    )
    expect(mocks.abandonTask).toHaveBeenCalledOnce()
    expect(mocks.clearConversation).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(store.get(difyBuilderDraftAtom)).toBe('Next requirement')
    expect(screen.getByText('I found the failing configuration.')).toBeInTheDocument()
  })

  it('offers only server-provided Fix decisions while the original command is busy', async () => {
    const user = userEvent.setup()
    const fixPayload = { fix_intent_id: 'fix-1', expected_task_id: 'task-1' }
    renderPanel(
      {
        ...sessionView,
        run_status: 'processing',
        task_id: 'task-1',
        pending_fix_context: {
          run_id: 'run-1',
          title: '',
          error_code: '',
          message: '',
          trace_ref: '',
        },
        actions: [
          { id: 'dismiss_fix', label: 'Keep current task', kind: 'secondary', payload: fixPayload },
          {
            id: 'stop_and_switch_fix',
            label: 'Stop and fix',
            kind: 'destructive',
            payload: fixPayload,
          },
        ],
        decision: {
          title: 'Switch to fixing this error?',
          default_option_id: 'dismiss_fix',
          options: [
            { id: 'dismiss_fix', label: 'Keep current task' },
            { id: 'stop_and_switch_fix', label: 'Stop and fix' },
            { id: 'run_test', label: 'Unrelated test command' },
          ],
        },
      },
      (store) => store.set(difyBuilderSessionBusyAtom, true),
    )
    expect(screen.getByRole('radio', { name: 'Keep current task' })).toBeEnabled()
    expect(screen.getByText('run-1')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Unrelated test command' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'difyBuilder.reset' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Keep current task' }))
    expect(mocks.runAction).toHaveBeenCalledWith('confirm', {
      option_id: 'dismiss_fix',
      ...fixPayload,
    })
    expect(screen.getByText('I found the failing configuration.')).toBeInTheDocument()
    expect(mocks.reset).not.toHaveBeenCalled()
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
    const reset = screen.getByRole('button', { name: 'difyBuilder.reset' })

    expect(reset).toBeDisabled()
    await user.click(reset)
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'common.operation.close' })).toBeEnabled()
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
      name: 'difyBuilder.messagePlaceholder',
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
      name: 'difyBuilder.messagePlaceholder',
    })
    const sendButton = screen.getByRole('button', {
      name: 'difyBuilder.messageSend',
    })
    const form = composer.closest('form')

    expect(composer).toBeEnabled()
    expect(composer).toHaveAccessibleDescription('difyBuilder.modelRequired')
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

  it('does not submit while Enter confirms an IME composition', async () => {
    renderPanel()
    const composer = screen.getByRole('textbox', {
      name: 'difyBuilder.messagePlaceholder',
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
        name: 'difyBuilder.messagePlaceholder',
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

  it.each([
    ['retry_repair', 'difyBuilder.copy.actions.tryAgain'],
    ['finish_repair', 'difyBuilder.copy.actions.finish'],
  ])(
    'submits %s without a rejection reason when no repair is available',
    async (optionId, label) => {
      const user = userEvent.setup()
      renderPanel({
        ...choiceView,
        actions: [
          { id: 'retry_repair', label: { type: 'copy', id: 'actions.tryAgain' }, kind: 'primary' },
          { id: 'finish_repair', label: { type: 'copy', id: 'actions.finish' }, kind: 'secondary' },
        ],
        decision: {
          title: { type: 'copy', id: 'labels.noRepairAvailable' },
          description: 'Try again to find a repair, or finish this session.',
          default_option_id: 'retry_repair',
          submit: { id: 'confirm', label: 'Submit', kind: 'primary' },
          options: [
            {
              id: 'retry_repair',
              label: { type: 'copy', id: 'actions.tryAgain' },
              is_default: true,
            },
            { id: 'finish_repair', label: { type: 'copy', id: 'actions.finish' } },
          ],
        },
      })

      const dock = screen.getByRole('region', { name: 'difyBuilder.copy.labels.noRepairAvailable' })
      expect(within(dock).getAllByRole('radio')).toHaveLength(2)
      expect(within(dock).queryByRole('textbox')).not.toBeInTheDocument()
      expect(
        within(dock).getByRole('radio', { name: 'difyBuilder.copy.actions.tryAgain' }),
      ).toBeChecked()
      const submit = within(dock).getByRole('button', { name: 'difyBuilder.copy.actions.tryAgain' })
      expect(submit).toBeEnabled()

      await user.click(within(dock).getByRole('radio', { name: label }))
      expect(submit).toHaveAccessibleName(label)
      await user.click(submit)

      expect(mocks.runAction.mock.calls.at(-1)?.slice(0, 2)).toEqual([
        'confirm',
        { option_id: optionId },
      ])
    },
  )

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
    await user.click(screen.getByRole('button', { name: 'difyBuilder.runTest' }))

    const log = screen.getByRole('log', { name: 'difyBuilder.panelTitle' })
    expect(
      await within(log).findByRole('heading', { name: 'Provide test data' }),
    ).toBeInTheDocument()
    expect(within(log).getByRole('textbox', { name: 'Topic' })).toHaveValue('AI agents')
    expect(within(log).getByRole('textbox', { name: 'Topic' })).toHaveAttribute('readonly')
    expect(screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })).toBeDisabled()

    await act(async () => {
      finishAction(false)
      await action
    })

    const restoredField = await screen.findByRole('textbox', { name: 'Topic' })
    expect(restoredField).toHaveValue('AI agents')
    expect(restoredField).not.toHaveAttribute('readonly')
    expect(
      screen.queryByRole('textbox', { name: 'difyBuilder.messagePlaceholder' }),
    ).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'difyBuilder.runTest' })).toBeDisabled()
    act(() =>
      store.set(difyBuilderCanvasAppliedViewAtom, {
        sessionId: view.session_id,
        version: 2,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'difyBuilder.runTest' }))
    expect(mocks.runAction.mock.calls.at(-1)?.slice(0, 2)).toEqual([
      'provide_testdata',
      {
        mode: 'provide',
        inputs: { topic: 'AI agents' },
      },
    ])
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
    expect(screen.getByRole('button', { name: 'Re-check' })).toBeDisabled()
  })

  it('keeps a paused composer disabled without a separate recovery alert', () => {
    renderPanel({
      ...sessionView,
      actions: [],
      recovery: {
        can_continue: false,
        can_restart: true,
        recovery_class: 'structural_invalidating',
      },
      run_status: 'paused',
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'difyBuilder.messagePlaceholder' })).toBeDisabled()
  })

  it('offers an accessible retry action after canvas refresh failure', async () => {
    const user = userEvent.setup()
    const { store, retryCanvasRefresh } = renderPanel(choiceView, (store) => {
      store.set(difyBuilderCanvasRefreshFailedAtom, true)
    })

    const retry = screen.getByRole('button', { name: 'workflow.common.retryCanvasSync' })
    expect(retry).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Approve plan' })).toBeDisabled()
    expect(
      screen.queryByRole('textbox', { name: 'difyBuilder.messagePlaceholder' }),
    ).not.toBeInTheDocument()

    await user.click(retry)

    expect(retryCanvasRefresh).toHaveBeenCalledOnce()
    expect(store.get(difyBuilderCanvasRefreshingAtom)).toBe(true)
    expect(retry).toHaveAttribute('aria-disabled', 'true')
  })
})
