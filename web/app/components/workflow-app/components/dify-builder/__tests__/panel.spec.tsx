import type { ConversationItem, SessionView } from '../types'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import DifyBuilderPanel from '../panel'
import { difyBuilderConversationAtom, difyBuilderSessionViewAtom } from '../session/state'
import {
  difyBuilderCanvasRefreshFailedAtom,
  difyBuilderCanvasRefreshingAtom,
  difyBuilderRuntimeAtom,
} from '../store'

const mocks = vi.hoisted(() => ({
  closePanel: vi.fn(),
  reset: vi.fn(),
  runAction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => true),
  startBuild: vi.fn(async () => true),
}))

const sessionView: SessionView = {
  actions: [{ id: 'approve_plan', label: 'Approve plan', kind: 'primary' }],
  app_revision: { observed: 'hash-1', current: 'hash-1', conflicted: false },
  app_id: 'app-1',
  canvas_read_only: false,
  active_interaction: null,
  conversation_last_seq: 1,
  entry_mode: 'fix',
  interrupted: false,
  phase: 'plan',
  run_status: 'waiting_input',
  session_id: 'session-1',
  state: 'fix.await_approval',
  version: 1,
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
  store.set(difyBuilderSessionViewAtom, view)
  store.set(difyBuilderConversationAtom, conversation)
  store.set(difyBuilderRuntimeAtom, {
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    onSyncDraft: vi.fn(async () => undefined),
    session: {
      refresh: vi.fn(async () => true),
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
  const result = render(
    <Provider store={store}>
      <DifyBuilderPanel />
    </Provider>,
  )
  return { ...result, store }
}

describe('DifyBuilderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps actions above a text-only composer and sends chat during an active waiting flow', async () => {
    const user = userEvent.setup()
    renderPanel()

    const action = screen.getByRole('button', { name: 'Approve plan' })
    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    expect(action.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Model selector' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /attach/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /voice|microphone/i })).not.toBeInTheDocument()
    expect(composer).toBeEnabled()
    await user.type(composer, 'Make the repair smaller')
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))
    expect(mocks.sendMessage).toHaveBeenCalledWith('Make the repair smaller')
    await waitFor(() => expect(composer).toHaveValue(''))
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
      run_status: 'complete',
      state: 'complete',
    })

    const composer = screen.getByRole('textbox', {
      name: 'workflow.difyBuilder.messagePlaceholder',
    })
    await user.type(composer, 'Build a smaller workflow')
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

    expect(mocks.startBuild).toHaveBeenCalledWith('app-1', 'Build a smaller workflow', undefined)
    expect(mocks.sendMessage).not.toHaveBeenCalled()
  })

  it('submits server actions from the fixed action bar', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Approve plan' }))

    expect(mocks.runAction).toHaveBeenCalledWith('approve_plan', {})
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
          card,
          valid_at_version: 1,
        },
        conversation_last_seq: 0,
        phase: 'test',
        state: 'build.await_testdata',
      },
      undefined,
      [card],
    )

    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'AI agents')
    await user.click(screen.getByRole('button', { name: 'Provide test data' }))

    expect(mocks.runAction).toHaveBeenCalledWith('provide_testdata', {
      mode: 'provide',
      inputs: { topic: 'AI agents' },
    })
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
        card,
        valid_at_version: 1,
      },
      conversation_last_seq: 0,
      phase: 'test',
      state: 'build.await_testdata',
    }
    const { store } = renderPanel(view, undefined, [card])

    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'AI agents')
    act(() => {
      store.set(difyBuilderSessionViewAtom, {
        ...view,
        version: 2,
        active_interaction: {
          action_id: 'provide_testdata',
          card: { ...card, payload: { ...card.payload } },
          valid_at_version: 2,
        },
      })
    })

    expect(screen.getByRole('textbox', { name: 'Topic' })).toHaveValue('AI agents')
    await user.click(screen.getByRole('button', { name: 'Provide test data' }))
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
          card,
          valid_at_version: 1,
        },
        conversation_last_seq: 0,
        phase: 'test',
        state: 'build.await_testdata',
      },
      undefined,
      [card],
    )
    const input = screen.getByRole('textbox', { name: 'Profile' })
    const action = screen.getByRole('button', { name: 'Provide test data' })

    await user.click(input)
    await user.paste('{"name":')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(action).toBeDisabled()
    await user.click(action)
    expect(mocks.runAction).not.toHaveBeenCalled()

    await user.clear(input)
    await user.paste('{"name":"Ada"}')
    await waitFor(() => expect(action).toBeEnabled())
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
          card,
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
      entry_mode: 'fix_checklist',
      state: 'checklist.await_recheck',
    })

    expect(screen.getByRole('button', { name: 'Re-check' })).toBeDisabled()
  })

  it('allows an interrupted execution to be reset while keeping the composer disabled', async () => {
    const user = userEvent.setup()
    renderPanel({
      ...sessionView,
      actions: [],
      canvas_read_only: true,
      interrupted: true,
      run_status: 'processing',
      state: 'build.publish',
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
    const { store } = renderPanel(sessionView, (store) => {
      store.set(difyBuilderCanvasRefreshFailedAtom, true)
    })

    const retry = screen.getByRole('button', { name: 'common.operation.retry' })
    expect(retry).toBeEnabled()

    await user.click(retry)

    expect(store.get(difyBuilderCanvasRefreshingAtom)).toBe(true)
    expect(retry).toHaveAttribute('aria-disabled', 'true')
  })
})
