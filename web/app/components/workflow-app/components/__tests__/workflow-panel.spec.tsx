import type { ReactNode } from 'react'
import type { DifyBuilderRuntime } from '../dify-builder/store'
import type { Shape } from '@/app/components/workflow/store/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import * as React from 'react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { difyBuilderSessionBusyAtom } from '../dify-builder/session/state'
import { difyBuilderRuntimeAtom } from '../dify-builder/store'
import WorkflowPanel from '../workflow-panel'

type WorkflowStoreState = Partial<Shape>

const mockUseIsChatMode = vi.fn()
const mockSetShowPanel = vi.fn()
const mockStartFix = vi.fn(async () => true)

let workflowStoreState: WorkflowStoreState

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-123' }),
}))

const renderPanel = (initialStoreState: WorkflowStoreState, children = <WorkflowPanel />) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedAppDetail(
    queryClient,
    createAppDetailFixture({
      id: 'app-123',
      mode: 'workflow' as const,
      workflow: { id: 'workflow-version-id' },
    }),
  )
  return renderWorkflowComponent(children, {
    initialStoreState,
    queryClient,
    resource: { kind: 'app', appId: 'app-123', mode: 'workflow' },
  })
}

vi.mock('@/app/components/workflow/panel', () => ({
  default: ({
    components,
    versionHistoryPanelProps,
  }: {
    components?: {
      left?: ReactNode
      right?: ReactNode
    }
    versionHistoryPanelProps?: {
      getVersionListUrl: string
      deleteVersionUrl: (versionId: string) => string
      updateVersionUrl: (versionId: string) => string
      latestVersionId?: string
    }
  }) => (
    <div
      data-testid="panel"
      data-version-list-url={versionHistoryPanelProps?.getVersionListUrl ?? ''}
      data-delete-version-url={versionHistoryPanelProps?.deleteVersionUrl('version-1') ?? ''}
      data-update-version-url={versionHistoryPanelProps?.updateVersionUrl('version-1') ?? ''}
      data-latest-version-id={versionHistoryPanelProps?.latestVersionId ?? ''}
    >
      <div data-testid="panel-left">{components?.left}</div>
      <div data-testid="panel-right">{components?.right}</div>
    </div>
  ),
}))

vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    const LazyComp = React.lazy(loader)
    return function DynamicWrapper(props: Record<string, unknown>) {
      return React.createElement(
        React.Suspense,
        { fallback: null },
        React.createElement(LazyComp, props),
      )
    }
  },
}))

vi.mock('@/service/log', () => ({
  fetchRunDetail: vi.fn().mockResolvedValue(undefined),
  fetchTracingList: vi.fn().mockResolvedValue({ data: [] }),
}))

vi.mock('@/app/components/workflow/panel/record', () => ({
  default: () => <div data-testid="record-panel">record</div>,
}))

vi.mock('@/app/components/workflow/panel/chat-record', () => ({
  default: () => <div data-testid="chat-record-panel">chat-record</div>,
}))

vi.mock('@/app/components/workflow/panel/debug-and-preview', () => ({
  default: () => <div data-testid="debug-and-preview-panel">debug</div>,
}))

vi.mock('@/app/components/workflow/panel/workflow-preview', () => ({
  default: ({
    fixWithBuilderDisabled,
    onFixRun,
  }: {
    fixWithBuilderDisabled?: boolean
    onFixRun?: (runId: string) => void
  }) => (
    <div data-testid="workflow-preview-panel">
      preview
      {onFixRun && (
        <button
          type="button"
          disabled={fixWithBuilderDisabled}
          onClick={() => onFixRun('failed-run-1')}
        >
          Fix failed run with App Builder
        </button>
      )}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/panel/chat-variable-panel', () => ({
  default: () => <div data-testid="chat-variable-panel">chat-variable</div>,
}))

vi.mock('@/app/components/workflow/panel/global-variable-panel', () => ({
  default: () => <div data-testid="global-variable-panel">global-variable</div>,
}))

vi.mock('@/app/components/workflow/editor-resource/state', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/components/workflow/editor-resource/state')>()
  const { atom } = await import('jotai')
  return { ...actual, isChatflowAtom: atom(() => mockUseIsChatMode()) }
})

const createDifyBuilderRuntime = (enabled: boolean, canEdit: boolean): DifyBuilderRuntime => ({
  appId: 'app-123',
  canEdit,
  enabled,
  getCanvasSnapshot: () => ({ nodes: [], edgeCount: 0 }),
  session: {
    onCanvasRefreshed: vi.fn(),
    getTrace: vi.fn(() => ({ entries: [], truncated: false })),
    loadOlderConversation: vi.fn(async () => true),
    refresh: vi.fn(async () => true),
    restore: vi.fn(async () => true),
    reset: vi.fn(),
    runAction: vi.fn(async () => true),
    sendMessage: vi.fn(async () => true),
    startBuild: vi.fn(async () => true),
    startChecklistFix: vi.fn(async () => true),
    startEdit: vi.fn(async () => true),
    startFix: mockStartFix,
    updateModel: vi.fn(async () => true),
  },
  setShowPanel: mockSetShowPanel,
})

const renderWorkflowPanel = ({
  busy = false,
  canEdit = true,
  enabled,
}: {
  busy?: boolean
  canEdit?: boolean
  enabled: boolean
}) => {
  const store = createStore()
  store.set(difyBuilderRuntimeAtom, createDifyBuilderRuntime(enabled, canEdit))
  store.set(difyBuilderSessionBusyAtom, busy)

  return renderPanel(
    workflowStoreState,
    <Provider store={store}>
      <EditorResourceScope resource={{ kind: 'app', appId: 'app-123', mode: 'workflow' }}>
        <WorkflowPanel />
      </EditorResourceScope>
    </Provider>,
  )
}

describe('WorkflowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = {
      historyWorkflowData: undefined,
      showDebugAndPreviewPanel: false,
      showChatVariablePanel: false,
      showGlobalVariablePanel: false,
    }
    mockUseIsChatMode.mockReturnValue(false)
  })

  it('should configure workflow version history urls and latest version id for the panel shell', async () => {
    renderPanel(workflowStoreState)

    const panel = await screen.findByTestId('panel')
    expect(panel).toHaveAttribute('data-version-list-url', '/apps/app-123/workflows')
    expect(panel).toHaveAttribute('data-delete-version-url', '/apps/app-123/workflows/version-1')
    expect(panel).toHaveAttribute('data-update-version-url', '/apps/app-123/workflows/version-1')
    expect(panel).toHaveAttribute('data-latest-version-id', 'workflow-version-id')
  })

  it('should close the selected log and reopen on the default detail tab', async () => {
    await import('@/app/components/base/message-log-modal')
    const user = userEvent.setup()
    const messageLogItem = {
      id: 'log-1',
      content: 'Answer',
      isAnswer: true,
      workflow_run_id: 'run-1',
    }
    const { store } = renderPanel({ messageLogItem })
    expect(await screen.findByRole('tab', { name: 'runLog.detail' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('tab', { name: 'runLog.tracing' }))
    expect(screen.getByRole('tab', { name: 'runLog.tracing' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'runLog.detail' })).not.toBeInTheDocument(),
    )
    act(() => store.getState().setMessageLogItem(messageLogItem))
    expect(await screen.findByRole('tab', { name: 'runLog.detail' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('should switch right-side workflow panels based on chat mode and workflow state', async () => {
    workflowStoreState = {
      historyWorkflowData: { id: 'history-1', status: 'succeeded' },
      showDebugAndPreviewPanel: true,
      showChatVariablePanel: true,
      showGlobalVariablePanel: true,
    }
    mockUseIsChatMode.mockReturnValue(true)

    const { unmount } = renderPanel(workflowStoreState)

    expect(await screen.findByTestId('chat-record-panel')).toBeInTheDocument()
    expect(screen.getByTestId('debug-and-preview-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-variable-panel')).toBeInTheDocument()
    expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workflow-preview-panel')).not.toBeInTheDocument()

    unmount()
    mockUseIsChatMode.mockReturnValue(false)
    renderPanel(workflowStoreState)

    expect(await screen.findByTestId('record-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-preview-panel')).toBeInTheDocument()
    expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-record-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('debug-and-preview-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-variable-panel')).not.toBeInTheDocument()
  })

  it('should hide live run Fix when Builder is disabled and start it when enabled', async () => {
    const user = userEvent.setup()
    workflowStoreState.showDebugAndPreviewPanel = true

    const { unmount } = renderWorkflowPanel({ enabled: false })
    await screen.findByTestId('workflow-preview-panel')
    expect(
      screen.queryByRole('button', { name: 'Fix failed run with App Builder' }),
    ).not.toBeInTheDocument()

    unmount()
    renderWorkflowPanel({ enabled: true })
    await user.click(await screen.findByRole('button', { name: 'Fix failed run with App Builder' }))

    expect(mockSetShowPanel).toHaveBeenCalledWith(true)
    expect(mockStartFix).toHaveBeenCalledExactlyOnceWith('app-123', 'failed-run-1', undefined)
  })

  it('should keep run Fix disabled without edit access or while the Builder session is busy', async () => {
    workflowStoreState.showDebugAndPreviewPanel = true

    const { unmount } = renderWorkflowPanel({ canEdit: false, enabled: true })
    expect(
      await screen.findByRole('button', { name: 'Fix failed run with App Builder' }),
    ).toBeDisabled()

    unmount()
    renderWorkflowPanel({ busy: true, enabled: true })
    expect(
      await screen.findByRole('button', { name: 'Fix failed run with App Builder' }),
    ).toBeDisabled()
  })

  it('should hide run Fix while viewing history even when the live preview is open', async () => {
    workflowStoreState.historyWorkflowData = { id: 'history-1', status: 'succeeded' }
    workflowStoreState.showDebugAndPreviewPanel = true
    renderWorkflowPanel({ enabled: true })

    await screen.findByTestId('record-panel')
    await screen.findByTestId('workflow-preview-panel')
    expect(
      screen.queryByRole('button', { name: 'Fix failed run with App Builder' }),
    ).not.toBeInTheDocument()
    expect(mockStartFix).not.toHaveBeenCalled()
  })
})
