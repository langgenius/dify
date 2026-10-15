import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { ReactNode } from 'react'
import type { Shape } from '@/app/components/workflow/store/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryWrapper, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import WorkflowPanel from '../workflow-panel'

type WorkflowStoreState = Partial<Shape>

const mockUseIsChatMode = vi.fn()

let workflowStoreState: WorkflowStoreState

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  useParams: () => ({ appId: 'app-123' }),
}))

const renderPanel = (initialStoreState: WorkflowStoreState) => {
  const { queryClient } = createConsoleQueryWrapper({ appDslVersion: '0.6.0' })
  seedAppDetail(
    queryClient,
    createAppDetailFixture({
      id: 'app-123',
      mode: 'workflow' as const,
      workflow: { id: 'workflow-version-id' },
    }),
  )
  return renderWorkflowComponent(<WorkflowPanel />, {
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
      restoreVersionUrl: (versionId: string) => string
      updateVersionUrl: (versionId: string) => string
      latestVersionId?: string
      appMode?: AppMode
    }
  }) => (
    <div
      data-testid="panel"
      data-version-list-url={versionHistoryPanelProps?.getVersionListUrl ?? ''}
      data-delete-version-url={versionHistoryPanelProps?.deleteVersionUrl('version-1') ?? ''}
      data-restore-version-url={versionHistoryPanelProps?.restoreVersionUrl('version-1') ?? ''}
      data-update-version-url={versionHistoryPanelProps?.updateVersionUrl('version-1') ?? ''}
      data-latest-version-id={versionHistoryPanelProps?.latestVersionId ?? ''}
      data-app-mode={versionHistoryPanelProps?.appMode ?? ''}
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
  default: () => <div data-testid="workflow-preview-panel">preview</div>,
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
    expect(panel).toHaveAttribute(
      'data-restore-version-url',
      '/apps/app-123/workflows/version-1/restore',
    )
    expect(panel).toHaveAttribute('data-update-version-url', '/apps/app-123/workflows/version-1')
    expect(panel).toHaveAttribute('data-latest-version-id', 'workflow-version-id')
    expect(panel).toHaveAttribute('data-app-mode', 'workflow')
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
})
