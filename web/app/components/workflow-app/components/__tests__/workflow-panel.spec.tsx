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

let chatflowMode = false

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
    resource: { kind: 'app', appId: 'app-123', mode: chatflowMode ? 'advanced-chat' : 'workflow' },
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
      latestVersionId?: string
    }
  }) => (
    <div
      data-testid="panel"
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
  fetchTracingList: vi.fn().mockResolvedValue([]),
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

describe('WorkflowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflowStoreState = {
      historyWorkflowData: undefined,
      showDebugAndPreviewPanel: false,
      showChatVariablePanel: false,
      showGlobalVariablePanel: false,
    }
    chatflowMode = false
  })

  it('should pass the latest version id to the panel shell', async () => {
    renderPanel(workflowStoreState)

    const panel = await screen.findByTestId('panel')
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
    chatflowMode = true

    const { unmount } = renderPanel(workflowStoreState)

    expect(await screen.findByTestId('chat-record-panel')).toBeInTheDocument()
    expect(screen.getByTestId('debug-and-preview-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-variable-panel')).toBeInTheDocument()
    expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workflow-preview-panel')).not.toBeInTheDocument()

    unmount()
    chatflowMode = false
    renderPanel(workflowStoreState)

    expect(await screen.findByTestId('record-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-preview-panel')).toBeInTheDocument()
    expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-record-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('debug-and-preview-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-variable-panel')).not.toBeInTheDocument()
  })
})
