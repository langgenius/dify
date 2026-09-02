import type { SessionView } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import DifyBuilderPanel from '../panel'
import { difyBuilderSessionViewAtom } from '../session/state'
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
  conversation: [
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
        trace: { status: 'completed' },
        reply_text: 'I found the failing configuration.',
      },
    },
  ],
  entry_mode: 'fix',
  interrupted: false,
  phase: 'plan',
  run_status: 'waiting_input',
  session_id: 'session-1',
  state: 'fix.await_approval',
  version: 1,
}

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
) => {
  const store = createStore()
  store.set(difyBuilderSessionViewAtom, view)
  store.set(difyBuilderRuntimeAtom, {
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    onSyncDraft: vi.fn(async () => undefined),
    session: {
      refresh: vi.fn(async () => true),
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
    renderPanel({
      ...sessionView,
      actions: [{ id: 'provide_testdata', label: 'Provide test data', kind: 'primary' }],
      conversation: [
        {
          seq: 0,
          at_version: 1,
          kind: 'form',
          payload: {
            variant: 'testdata',
            fields: [{ key: 'topic', label: 'Topic', type: 'text-input' }],
            values: {},
          },
        },
      ],
      phase: 'test',
      state: 'build.await_testdata',
    })

    await user.type(screen.getByRole('textbox', { name: 'Topic' }), 'AI agents')
    await user.click(screen.getByRole('button', { name: 'Provide test data' }))

    expect(mocks.runAction).toHaveBeenCalledWith('provide_testdata', {
      mode: 'provide',
      inputs: { topic: 'AI agents' },
    })
  })

  it('blocks malformed JSON test data and submits the parsed value after correction', async () => {
    const user = userEvent.setup()
    renderPanel({
      ...sessionView,
      actions: [{ id: 'provide_testdata', label: 'Provide test data', kind: 'primary' }],
      conversation: [
        {
          seq: 0,
          at_version: 1,
          kind: 'form',
          payload: {
            variant: 'testdata',
            fields: [{ key: 'profile', label: 'Profile', type: 'json_object' }],
            values: {},
          },
        },
      ],
      phase: 'test',
      state: 'build.await_testdata',
    })
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
    renderPanel({
      ...sessionView,
      conversation: [
        {
          seq: 0,
          at_version: 1,
          kind: 'form',
          payload: {
            variant: 'build_requirements',
            fields: [{ key: 'retries', label: 'Retries', type: 'number' }],
            values: { retries: 3 },
          },
        },
      ],
    })

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
      run_status: 'executing',
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
