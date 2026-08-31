import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSetAtom } from 'jotai'
import { difyBuilderSessionViewAtom } from '@/app/components/dify-builder/state'
import { DifyBuilderProvider } from '../provider'
import { difyBuilderStartPromptAtom, difyBuilderStartRunFixAtom } from '../store'

const mocks = vi.hoisted(() => ({
  controllerHook: vi.fn(),
  refreshCanvas: vi.fn(async () => undefined),
  reset: vi.fn(),
  runAction: vi.fn(async () => true),
  sendMessage: vi.fn(async () => true),
  setCanvasReadOnly: vi.fn(),
  setShowPanel: vi.fn(),
  startBuild: vi.fn(async () => true),
  startChecklistFix: vi.fn(async () => true),
  startEdit: vi.fn(async () => true),
  startFix: vi.fn(async () => true),
  syncDraft: vi.fn(async () => undefined),
  updateModel: vi.fn(async () => true),
}))

vi.mock('@/app/components/dify-builder/use-dify-builder-session', () => ({
  useDifyBuilderSessionController: () => {
    mocks.controllerHook()
    return {
      refresh: vi.fn(),
      reset: mocks.reset,
      runAction: mocks.runAction,
      sendMessage: mocks.sendMessage,
      startBuild: mocks.startBuild,
      startChecklistFix: mocks.startChecklistFix,
      startEdit: mocks.startEdit,
      startFix: mocks.startFix,
      updateModel: mocks.updateModel,
    }
  },
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      setCanvasReadOnly: typeof mocks.setCanvasReadOnly
      setShowDifyBuilderPanel: typeof mocks.setShowPanel
    }) => T,
  ) =>
    selector({
      setCanvasReadOnly: mocks.setCanvasReadOnly,
      setShowDifyBuilderPanel: mocks.setShowPanel,
    }),
}))

const Probe = () => {
  const setSessionView = useSetAtom(difyBuilderSessionViewAtom)
  const startPrompt = useSetAtom(difyBuilderStartPromptAtom)
  const startRunFix = useSetAtom(difyBuilderStartRunFixAtom)
  return (
    <>
      <button type="button" onClick={() => void startPrompt('Build a support bot')}>
        Send prompt
      </button>
      <button type="button" onClick={() => void startRunFix('failed-run-42')}>
        Fix run
      </button>
      <button
        type="button"
        onClick={() =>
          setSessionView({
            app_id: 'app-1',
            canvas_read_only: true,
            conversation: [],
            interrupted: false,
            run_status: 'executing',
            session_id: 'session-1',
            state: 'fix.diagnose',
            version: 1,
          })
        }
      >
        Stream update
      </button>
    </>
  )
}

const renderProvider = (edgeCount = 0) =>
  render(
    <DifyBuilderProvider
      appId="app-1"
      canEdit
      getCanvasSnapshot={() => ({ nodes: [], edgeCount })}
      onRefreshCanvas={mocks.refreshCanvas}
      onSyncDraft={mocks.syncDraft}
    >
      <Probe />
    </DifyBuilderProvider>,
  )

describe('DifyBuilderProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a build session for an empty canvas', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Send prompt' }))

    expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
    expect(mocks.startBuild).toHaveBeenCalledWith('app-1', 'Build a support bot', undefined)
    expect(mocks.startEdit).not.toHaveBeenCalled()
  })

  it('starts an edit session for a connected canvas', async () => {
    const user = userEvent.setup()
    renderProvider(1)

    await user.click(screen.getByRole('button', { name: 'Send prompt' }))

    expect(mocks.startEdit).toHaveBeenCalledWith('app-1', 'Build a support bot', undefined)
    expect(mocks.startBuild).not.toHaveBeenCalled()
  })

  it('opens a fix session for the selected failed run id', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByRole('button', { name: 'Fix run' }))

    expect(mocks.setShowPanel).toHaveBeenCalledWith(true)
    expect(mocks.startFix).toHaveBeenCalledWith('app-1', 'failed-run-42', undefined)
  })

  it('does not rerender the controller boundary for streamed session updates', async () => {
    const user = userEvent.setup()
    renderProvider()
    const initialRenderCount = mocks.controllerHook.mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Stream update' }))

    expect(mocks.controllerHook).toHaveBeenCalledTimes(initialRenderCount)
    expect(mocks.setCanvasReadOnly).toHaveBeenLastCalledWith(true)
  })
})
