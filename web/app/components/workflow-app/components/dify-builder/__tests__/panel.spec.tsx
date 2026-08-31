import type { SessionView } from '@/app/components/dify-builder/contract/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { difyBuilderSessionViewAtom } from '@/app/components/dify-builder/state'
import DifyBuilderPanel from '../panel'
import { difyBuilderRuntimeAtom } from '../store'

const mocks = vi.hoisted(() => ({
  closePanel: vi.fn(),
  reset: vi.fn(),
  runAction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => true),
}))

const sessionView: SessionView = {
  actions: [{ id: 'approve_plan', label: 'Approve plan', kind: 'primary' }],
  app_id: 'app-1',
  canvas_read_only: false,
  conversation: [
    { seq: 0, at_version: 1, kind: 'user', payload: { text: 'Fix the workflow' } },
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

const renderPanel = () => {
  const store = createStore()
  store.set(difyBuilderSessionViewAtom, sessionView)
  store.set(difyBuilderRuntimeAtom, {
    appId: 'app-1',
    canEdit: true,
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    onSyncDraft: vi.fn(async () => undefined),
    session: {
      refresh: vi.fn(async () => true),
      reset: mocks.reset,
      runAction: mocks.runAction,
      sendMessage: mocks.sendMessage,
      startBuild: vi.fn(async () => true),
      startChecklistFix: vi.fn(async () => true),
      startEdit: vi.fn(async () => true),
      startFix: vi.fn(async () => true),
      updateModel: vi.fn(async () => true),
    },
    setShowPanel: mocks.closePanel,
  })
  return render(
    <Provider store={store}>
      <DifyBuilderPanel />
    </Provider>,
  )
}

describe('DifyBuilderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps actions above a text-only composer and sends text', async () => {
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

    await user.type(composer, 'Make the change smaller')
    await user.click(screen.getByRole('button', { name: 'workflow.difyBuilder.messageSend' }))

    expect(mocks.sendMessage).toHaveBeenCalledWith('Make the change smaller')
  })

  it('submits server actions from the fixed action bar', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Approve plan' }))

    expect(mocks.runAction).toHaveBeenCalledWith('approve_plan', {})
  })
})
