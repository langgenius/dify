import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import WorkflowPanel from '../workflow-panel'

type AppStoreState = {
  appDetail?: {
    id?: string
    workflow?: {
      id?: string
    }
  }
  currentLogItem?: { id: string }
  setCurrentLogItem: (item?: { id: string }) => void
  showMessageLogModal: boolean
  setShowMessageLogModal: (show: boolean) => void
  currentLogModalActiveTab?: string
}

type WorkflowStoreState = {
  historyWorkflowData?: Record<string, unknown>
  showDebugAndPreviewPanel: boolean
  showChatVariablePanel: boolean
  showGlobalVariablePanel: boolean
}

const mockUseIsChatMode = vi.fn()
const mockSetCurrentLogItem = vi.fn()
const mockSetShowMessageLogModal = vi.fn()

let appStoreState: AppStoreState
let workflowStoreState: WorkflowStoreState

vi.mock('@/app/components/app/store', () => ({
  useStore: <T,>(selector: (state: AppStoreState) => T) => selector(appStoreState),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: WorkflowStoreState) => T) => selector(workflowStoreState),
}))

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
    }
  }) => (
    <div
      data-testid="panel"
      data-version-list-url={versionHistoryPanelProps?.getVersionListUrl ?? ''}
      data-delete-version-url={versionHistoryPanelProps?.deleteVersionUrl('version-1') ?? ''}
      data-restore-version-url={versionHistoryPanelProps?.restoreVersionUrl('version-1') ?? ''}
      data-update-version-url={versionHistoryPanelProps?.updateVersionUrl('version-1') ?? ''}
      data-latest-version-id={versionHistoryPanelProps?.latestVersionId ?? ''}
    >
      <div data-testid="panel-left">{components?.left}</div>
      <div data-testid="panel-right">{components?.right}</div>
    </div>
  ),
}))

vi.mock('@/next/dynamic', () => ({
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

vi.mock('@/app/components/base/message-log-modal', () => ({
  default: ({
    currentLogItem,
    defaultTab,
    onCancel,
  }: {
    currentLogItem?: { id: string }
    defaultTab?: string
    onCancel: () => void
  }) => (
    <div data-testid="message-log-modal" data-current-log-id={currentLogItem?.id ?? ''} data-default-tab={defaultTab ?? ''}>
      <button type="button" onClick={onCancel}>close-message-log</button>
    </div>
  ),
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

vi.mock('@/app/components/workflow-app/hooks', () => ({
  useIsChatMode: () => mockUseIsChatMode(),
}))

describe('WorkflowPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appStoreState = {
      appDetail: {
        id: 'app-123',
        workflow: {
          id: 'workflow-version-id',
        },
      },
      currentLogItem: { id: 'log-1' },
      setCurrentLogItem: mockSetCurrentLogItem,
      showMessageLogModal: false,
      setShowMessageLogModal: mockSetShowMessageLogModal,
      currentLogModalActiveTab: 'detail',
    }
    workflowStoreState = {
      historyWorkflowData: undefined,
      showDebugAndPreviewPanel: false,
      showChatVariablePanel: false,
      showGlobalVariablePanel: false,
    }
    mockUseIsChatMode.mockReturnValue(false)
  })

  it('should configure workflow version history urls and latest version id for the panel shell', async () => {
    render(<WorkflowPanel />)

    const panel = await screen.findByTestId('panel')
    expect(panel).toHaveAttribute('data-version-list-url', '/apps/app-123/workflows')
    expect(panel).toHaveAttribute('data-delete-version-url', '/apps/app-123/workflows/version-1')
    expect(panel).toHaveAttribute('data-restore-version-url', '/apps/app-123/workflows/version-1/restore')
    expect(panel).toHaveAttribute('data-update-version-url', '/apps/app-123/workflows/version-1')
    expect(panel).toHaveAttribute('data-latest-version-id', 'workflow-version-id')
  })

  it('should render and close the message log modal from the left panel slot', async () => {
    const user = userEvent.setup()
    appStoreState = {
      ...appStoreState,
      showMessageLogModal: true,
    }

    render(<WorkflowPanel />)

    expect(await screen.findByTestId('message-log-modal')).toHaveAttribute('data-current-log-id', 'log-1')
    expect(screen.getByTestId('message-log-modal')).toHaveAttribute('data-default-tab', 'detail')

    await user.click(screen.getByRole('button', { name: /close-message-log/i }))

    expect(mockSetCurrentLogItem).toHaveBeenCalledWith()
    expect(mockSetShowMessageLogModal).toHaveBeenCalledWith(false)
  })

  it('should switch right-side workflow panels based on chat mode and workflow state', async () => {
    workflowStoreState = {
      historyWorkflowData: { id: 'history-1' },
      showDebugAndPreviewPanel: true,
      showChatVariablePanel: true,
      showGlobalVariablePanel: true,
    }
    mockUseIsChatMode.mockReturnValue(true)

    const { unmount } = render(<WorkflowPanel />)

    expect(await screen.findByTestId('chat-record-panel')).toBeInTheDocument()
    expect(screen.getByTestId('debug-and-preview-panel')).toBeInTheDocument()
    expect(screen.getByTestId('chat-variable-panel')).toBeInTheDocument()
    expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('record-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('workflow-preview-panel')).not.toBeInTheDocument()

    unmount()
    mockUseIsChatMode.mockReturnValue(false)
    render(<WorkflowPanel />)

    expect(await screen.findByTestId('record-panel')).toBeInTheDocument()
    expect(screen.getByTestId('workflow-preview-panel')).toBeInTheDocument()
    expect(screen.getByTestId('global-variable-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-record-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('debug-and-preview-panel')).not.toBeInTheDocument()
    expect(screen.queryByTestId('chat-variable-panel')).not.toBeInTheDocument()
  })
})
