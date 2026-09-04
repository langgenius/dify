import type { DifyBuilderRuntime } from '../store'
import type { SessionView } from '../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import DebugLogExport from '../debug-log-export'
import { difyBuilderSessionViewAtom } from '../session/state'
import { difyBuilderRuntimeAtom } from '../store'

const view = {
  session_id: 's1',
  app_id: 'app-1',
  version: 3,
  state: 'build.plan_approval',
  entry_mode: 'build',
  run_status: 'waiting_input',
  canvas_read_only: false,
  interrupted: false,
  conversation_last_seq: 1,
  model: null,
} as unknown as SessionView

const snapshot = {
  entries: [
    {
      seq: 1,
      ts: '2026-09-04T00:00:00.000Z',
      dir: 'out',
      kind: 'action',
      payload: { action_id: 'approve_plan' },
    },
    { seq: 2, ts: '2026-09-04T00:00:01.000Z', dir: 'in', kind: 'state', payload: {} },
  ],
  truncated: false,
}

const makeRuntime = () =>
  ({
    appId: 'app-1',
    canEdit: true,
    enabled: true,
    getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
    onSyncDraft: vi.fn(async () => undefined),
    session: { getTrace: vi.fn(() => snapshot) },
    setShowPanel: vi.fn(),
  }) as unknown as DifyBuilderRuntime

describe('DebugLogExport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:x'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('disables the trigger when there is no active runtime', () => {
    const store = createStore()
    store.set(difyBuilderRuntimeAtom, null)
    render(
      <Provider store={store}>
        <DebugLogExport />
      </Provider>,
    )
    expect(screen.getByRole('button', { name: 'common.operation.more' })).toBeDisabled()
  })

  it('downloads a JSON trace when the export item is clicked', async () => {
    const user = userEvent.setup()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const store = createStore()
    store.set(difyBuilderRuntimeAtom, makeRuntime())
    store.set(difyBuilderSessionViewAtom, view)
    render(
      <Provider store={store}>
        <DebugLogExport />
      </Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByText('workflow.difyBuilder.exportDebugLog'))

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob
    expect(blob.type).toBe('application/json')
    await expect(blob.text()).resolves.toContain('"entry_count": 2')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
